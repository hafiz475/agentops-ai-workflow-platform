#!/usr/bin/env python3
"""Credential-free Milestone 6 smoke test, run inside the Azure VM."""

import json
import time
import urllib.error
import urllib.request
import uuid

BASE = "http://127.0.0.1:3001/api/v1"


def request(
    method: str,
    path: str,
    payload: object | None = None,
    headers: dict[str, str] | None = None,
) -> tuple[int, object]:
    body = None if payload is None else json.dumps(payload).encode()
    merged = {"content-type": "application/json", **(headers or {})}
    call = urllib.request.Request(
        f"{BASE}{path}", data=body, method=method, headers=merged
    )
    try:
        with urllib.request.urlopen(call, timeout=20) as response:
            raw = response.read()
            return response.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as error:
        raw = error.read()
        return error.code, json.loads(raw) if raw else {}


def expect(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


def create_workflow(
    project_id: str, name: str, graph: dict[str, object]
) -> tuple[str, str]:
    status, workflow = request(
        "POST", f"/projects/{project_id}/workflows", {"name": name, "graph": graph}
    )
    expect(status == 201, f"workflow create failed: {status} {workflow}")
    workflow_id = str(workflow["id"])
    status, version = request(
        "POST",
        f"/projects/{project_id}/workflows/{workflow_id}/versions",
        {"graph": graph},
    )
    expect(status == 201, f"version create failed: {status} {version}")
    return workflow_id, str(version["id"])


def start_run(project_id: str, workflow_id: str, version_id: str, value: str) -> str:
    status, run = request(
        "POST",
        f"/projects/{project_id}/workflows/{workflow_id}/runs",
        {"workflowVersionId": version_id, "input": {"input": value}},
    )
    expect(status == 202, f"run create failed: {status} {run}")
    return str(run["id"])


def wait_run(
    project_id: str, workflow_id: str, run_id: str, wanted: set[str], timeout: int = 90
) -> dict[str, object]:
    deadline = time.time() + timeout
    while time.time() < deadline:
        status, run = request(
            "GET", f"/projects/{project_id}/workflows/{workflow_id}/runs/{run_id}"
        )
        expect(status == 200, f"run lookup failed: {status} {run}")
        if str(run["status"]) in wanted:
            return run  # type: ignore[return-value]
        time.sleep(1)
    raise RuntimeError(f"run {run_id} did not reach {sorted(wanted)}")


def agent_graph(tools: list[str], approvals: list[str]) -> dict[str, object]:
    return {
        "nodes": [
            {
                "id": "input",
                "type": "INPUT",
                "version": 1,
                "position": {"x": 0, "y": 0},
                "config": {},
            },
            {
                "id": "agent",
                "type": "AGENT",
                "version": 1,
                "position": {"x": 1, "y": 0},
                "config": {
                    "model": "development-agent-v1",
                    "allowed_tools": tools,
                    "max_steps": 5,
                    "max_duration_ms": 60000,
                    "max_tool_calls": 5,
                    "max_total_tokens": 10000,
                    "require_approval_for": approvals,
                },
            },
            {
                "id": "output",
                "type": "OUTPUT",
                "version": 1,
                "position": {"x": 2, "y": 0},
                "config": {},
            },
        ],
        "edges": [
            {"id": "e1", "source": "input", "target": "agent"},
            {"id": "e2", "source": "agent", "target": "output"},
        ],
    }


def main() -> None:
    for probe in ("/health", "/ready"):
        with urllib.request.urlopen(
            f"http://127.0.0.1:3001{probe}", timeout=10
        ) as response:
            expect(response.status == 200, f"{probe} failed")

    status, project = request(
        "POST", "/projects", {"name": f"M6 live smoke {uuid.uuid4()}"}
    )
    expect(status == 201, f"project create failed: {status}")
    project_id = str(project["id"])

    transform_plan = json.dumps(
        {
            "tool_plan": [
                {
                    "tool_name": "transform",
                    "arguments": {"template": {"text": "transformed"}, "input": {}},
                    "action_summary": "transform safely",
                }
            ],
            "final": {"text": "agent complete"},
        }
    )
    workflow_id, version_id = create_workflow(
        project_id, "Agent transform", agent_graph(["transform"], [])
    )
    run_id = start_run(project_id, workflow_id, version_id, transform_plan)
    run = wait_run(project_id, workflow_id, run_id, {"COMPLETED", "FAILED"})
    expect(run["status"] == "COMPLETED", f"transform agent failed: {run}")
    status, executions = request(
        "GET",
        f"/projects/{project_id}/workflows/{workflow_id}/runs/{run_id}/agent-executions",
    )
    expect(status == 200 and len(executions) == 1, "agent execution missing")  # type: ignore[arg-type]
    steps = executions[0]["steps"]  # type: ignore[index]
    expect(
        len(steps) == 2 and steps[0]["toolCall"]["status"] == "COMPLETED",
        "agent tool checkpoints invalid",
    )
    status, agent_trace = request(
        "GET", f"/projects/{project_id}/workflows/{workflow_id}/runs/{run_id}/trace"
    )
    agent_events = [item["eventType"] for item in agent_trace]  # type: ignore[union-attr]
    expect(
        status == 200
        and all(
            event in agent_events
            for event in (
                "AGENT_STARTED",
                "AGENT_STEP_STARTED",
                "TOOL_CALL_PROPOSED",
                "TOOL_CALL_COMPLETED",
                "AGENT_COMPLETED",
            )
        ),
        "agent trace timeline incomplete",
    )

    http_plan = json.dumps(
        {
            "tool_plan": [
                {
                    "tool_name": "http_request",
                    "arguments": {
                        "method": "GET",
                        "url": "https://example.com",
                        "headers": {},
                        "timeout_ms": 10000,
                        "max_response_bytes": 1048576,
                        "retry_non_idempotent": False,
                    },
                    "action_summary": "fetch public example",
                }
            ],
            "final": {"text": "http reviewed"},
        }
    )
    http_workflow, http_version = create_workflow(
        project_id, "Agent approval", agent_graph(["http_request"], ["http_request"])
    )
    http_run = start_run(project_id, http_workflow, http_version, http_plan)
    wait_run(project_id, http_workflow, http_run, {"WAITING_FOR_APPROVAL"})
    status, approvals = request("GET", f"/projects/{project_id}/approvals")
    pending = next(
        item
        for item in approvals
        if item["runId"] == http_run and item["status"] == "PENDING"
    )  # type: ignore[union-attr]
    expect(pending["approvalType"] == "AGENT_TOOL", "agent approval type missing")
    status, _ = request(
        "POST",
        f"/projects/{project_id}/approvals/{pending['id']}/approve",
        {"reason": "M6 live smoke"},
    )
    expect(status == 200, "agent approval failed")
    approved = wait_run(project_id, http_workflow, http_run, {"COMPLETED", "FAILED"})
    expect(
        approved["status"] == "COMPLETED",
        f"approved agent did not complete: {approved}",
    )
    status, executions = request(
        "GET",
        f"/projects/{project_id}/workflows/{http_workflow}/runs/{http_run}/agent-executions",
    )
    approved_call = executions[0]["steps"][0]["toolCall"]  # type: ignore[index]
    expect(
        status == 200 and approved_call["status"] == "COMPLETED",
        f"approved safe HTTP call failed: {approved_call}",
    )

    private_plan = json.dumps(
        {
            "tool_plan": [
                {
                    "tool_name": "http_request",
                    "arguments": {
                        "method": "GET",
                        "url": "http://127.0.0.1",
                        "headers": {},
                        "timeout_ms": 1000,
                        "max_response_bytes": 1024,
                        "retry_non_idempotent": False,
                    },
                    "action_summary": "attempt private destination",
                }
            ],
            "final": {"text": "private destination blocked"},
        }
    )
    private_workflow, private_version = create_workflow(
        project_id, "Agent SSRF", agent_graph(["http_request"], [])
    )
    private_run = start_run(project_id, private_workflow, private_version, private_plan)
    private = wait_run(
        project_id, private_workflow, private_run, {"COMPLETED", "FAILED"}
    )
    expect(
        private["status"] == "COMPLETED", "SSRF feedback did not permit bounded final"
    )
    status, executions = request(
        "GET",
        f"/projects/{project_id}/workflows/{private_workflow}/runs/{private_run}/agent-executions",
    )
    private_call = executions[0]["steps"][0]["toolCall"]  # type: ignore[index]
    expect(
        private_call["status"] == "FAILED"
        and "private or internal" in private_call["errorMessage"].lower(),
        "private destination was not blocked",
    )

    cancel_run = start_run(project_id, http_workflow, http_version, http_plan)
    wait_run(project_id, http_workflow, cancel_run, {"WAITING_FOR_APPROVAL"})
    status, cancelled = request(
        "POST",
        f"/projects/{project_id}/workflows/{http_workflow}/runs/{cancel_run}/cancel",
        {"reason": "M6 smoke cancellation"},
    )
    expect(
        status == 200 and cancelled["status"] == "CANCELLED",
        "cancellation during approval failed",
    )  # type: ignore[index]

    status, source = request(
        "POST",
        f"/projects/{project_id}/knowledge-sources",
        {
            "name": "M6 synthetic manual",
            "embeddingProvider": "development",
            "embeddingModel": "development-hash-v1",
        },
    )
    expect(status == 201, f"knowledge source failed: {source}")
    source_id = str(source["id"])
    boundary = f"agentops-{uuid.uuid4().hex}"
    document = b"Synthetic engineering report: abnormal vibration was found in the turbine bearing."
    body = (
        f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="m6-engineering.txt"\r\nContent-Type: text/plain\r\n\r\n'.encode()
        + document
        + f"\r\n--{boundary}--\r\n".encode()
    )
    upload = urllib.request.Request(
        f"{BASE}/projects/{project_id}/knowledge-sources/{source_id}/documents",
        data=body,
        method="POST",
        headers={"content-type": f"multipart/form-data; boundary={boundary}"},
    )
    with urllib.request.urlopen(upload, timeout=20) as response:
        uploaded = json.loads(response.read())
        expect(response.status == 202, "document upload failed")
    document_id = str(uploaded["id"])
    deadline = time.time() + 90
    while time.time() < deadline:
        status, current = request(
            "GET",
            f"/projects/{project_id}/knowledge-sources/{source_id}/documents/{document_id}",
        )
        if current["status"] in ("READY", "FAILED"):  # type: ignore[index]
            break
        time.sleep(1)
    expect(current["status"] == "READY", f"document ingestion failed: {current}")  # type: ignore[index]
    rag = {
        "nodes": [
            {
                "id": "input",
                "type": "INPUT",
                "version": 1,
                "position": {"x": 0, "y": 0},
                "config": {},
            },
            {
                "id": "retrieval",
                "type": "RETRIEVAL",
                "version": 1,
                "position": {"x": 1, "y": 0},
                "config": {
                    "knowledge_source_id": source_id,
                    "query_path": "input",
                    "top_k": 3,
                },
            },
            {
                "id": "prompt",
                "type": "PROMPT",
                "version": 1,
                "position": {"x": 2, "y": 0},
                "config": {
                    "template": "Question: {{input}}\nSources: {{retrieval_context}}"
                },
            },
            {
                "id": "llm",
                "type": "LLM",
                "version": 1,
                "position": {"x": 3, "y": 0},
                "config": {
                    "provider": "configured-default",
                    "model": "configured-default",
                    "temperature": 0,
                },
            },
            {
                "id": "output",
                "type": "OUTPUT",
                "version": 1,
                "position": {"x": 4, "y": 0},
                "config": {},
            },
        ],
        "edges": [
            {"id": "r1", "source": "input", "target": "retrieval"},
            {"id": "r2", "source": "retrieval", "target": "prompt"},
            {"id": "r3", "source": "prompt", "target": "llm"},
            {"id": "r4", "source": "llm", "target": "output"},
        ],
    }
    rag_workflow, rag_version = create_workflow(project_id, "RAG regression", rag)
    rag_run = start_run(
        project_id, rag_workflow, rag_version, "What abnormal vibration was found?"
    )
    rag_result = wait_run(project_id, rag_workflow, rag_run, {"COMPLETED", "FAILED"})
    expect(
        rag_result["status"] == "COMPLETED"
        and len(rag_result["output"]["retrieval_results"]) > 0,
        "RAG regression failed",
    )  # type: ignore[index]
    status, rag_trace = request(
        "GET", f"/projects/{project_id}/workflows/{rag_workflow}/runs/{rag_run}/trace"
    )
    expect(
        status == 200
        and any(item["eventType"] == "RETRIEVAL_COMPLETED" for item in rag_trace),
        "RAG source trace missing",
    )  # type: ignore[union-attr]

    foreign_status, foreign = request(
        "POST", "/projects", {"name": "M6 foreign project"}
    )
    expect(foreign_status == 201, "foreign project create failed")
    status, _ = request(
        "GET", f"/projects/{foreign['id']}/knowledge-sources/{source_id}"
    )  # type: ignore[index]
    expect(status == 404, "cross-project knowledge access was not blocked")

    branch = {
        "nodes": [
            {
                "id": "input",
                "type": "INPUT",
                "version": 1,
                "position": {"x": 0, "y": 0},
                "config": {},
            },
            {
                "id": "agent",
                "type": "AGENT",
                "version": 1,
                "position": {"x": 1, "y": 0},
                "config": {
                    "model": "development-agent-v1",
                    "allowed_tools": ["transform"],
                    "max_steps": 5,
                    "max_duration_ms": 60000,
                    "max_tool_calls": 5,
                    "max_total_tokens": 10000,
                    "require_approval_for": [],
                },
            },
            {
                "id": "condition",
                "type": "CONDITION",
                "version": 1,
                "position": {"x": 2, "y": 0},
                "config": {"path": "text", "operator": "CONTAINS", "value": "approved"},
            },
            {
                "id": "true-output",
                "type": "OUTPUT",
                "version": 1,
                "position": {"x": 3, "y": -1},
                "config": {},
            },
            {
                "id": "false-output",
                "type": "OUTPUT",
                "version": 1,
                "position": {"x": 3, "y": 1},
                "config": {},
            },
        ],
        "edges": [
            {"id": "b1", "source": "input", "target": "agent"},
            {"id": "b2", "source": "agent", "target": "condition"},
            {
                "id": "b3",
                "source": "condition",
                "target": "true-output",
                "branch": "true",
            },
            {
                "id": "b4",
                "source": "condition",
                "target": "false-output",
                "branch": "false",
            },
        ],
    }
    branch_workflow, branch_version = create_workflow(
        project_id, "Branch regression", branch
    )
    branch_run = start_run(
        project_id, branch_workflow, branch_version, "approved answer"
    )
    branch_result = wait_run(
        project_id, branch_workflow, branch_run, {"COMPLETED", "FAILED"}
    )
    expect(branch_result["status"] == "COMPLETED", "branching regression failed")
    status, branch_trace = request(
        "GET",
        f"/projects/{project_id}/workflows/{branch_workflow}/runs/{branch_run}/trace",
    )
    events = [item["eventType"] for item in branch_trace]  # type: ignore[union-attr]
    expect(
        status == 200 and "BRANCH_SELECTED" in events and "NODE_SKIPPED" in events,
        "branch trace regression failed",
    )

    human = {
        "nodes": [
            {
                "id": "input",
                "type": "INPUT",
                "version": 1,
                "position": {"x": 0, "y": 0},
                "config": {},
            },
            {
                "id": "prompt",
                "type": "PROMPT",
                "version": 1,
                "position": {"x": 1, "y": 0},
                "config": {"template": "Review: {{input}}"},
            },
            {
                "id": "llm",
                "type": "LLM",
                "version": 1,
                "position": {"x": 2, "y": 0},
                "config": {
                    "provider": "configured-default",
                    "model": "configured-default",
                    "temperature": 0,
                },
            },
            {
                "id": "approval",
                "type": "HUMAN_APPROVAL",
                "version": 1,
                "position": {"x": 3, "y": 0},
                "config": {
                    "title": "M6 regression approval",
                    "instructions": "Approve the live regression",
                    "allow_reject": True,
                },
            },
            {
                "id": "output",
                "type": "OUTPUT",
                "version": 1,
                "position": {"x": 4, "y": 0},
                "config": {},
            },
        ],
        "edges": [
            {"id": "h1", "source": "input", "target": "prompt"},
            {"id": "h2", "source": "prompt", "target": "llm"},
            {"id": "h3", "source": "llm", "target": "approval"},
            {"id": "h4", "source": "approval", "target": "output"},
        ],
    }
    human_workflow, human_version = create_workflow(
        project_id, "Human approval regression", human
    )
    human_run = start_run(
        project_id, human_workflow, human_version, "approval regression"
    )
    wait_run(project_id, human_workflow, human_run, {"WAITING_FOR_APPROVAL"})
    status, approvals = request("GET", f"/projects/{project_id}/approvals")
    human_approval = next(
        item
        for item in approvals
        if item["runId"] == human_run and item["status"] == "PENDING"
    )  # type: ignore[union-attr]
    expect(
        human_approval["approvalType"] == "HUMAN_NODE", "normal approval type regressed"
    )
    status, _ = request(
        "POST",
        f"/projects/{project_id}/approvals/{human_approval['id']}/approve",
        {"reason": "M6 regression"},
    )
    expect(status == 200, "normal approval failed")
    human_result = wait_run(
        project_id, human_workflow, human_run, {"COMPLETED", "FAILED"}
    )
    expect(human_result["status"] == "COMPLETED", "normal approval did not resume")
    status, human_trace = request(
        "GET",
        f"/projects/{project_id}/workflows/{human_workflow}/runs/{human_run}/trace",
    )
    model_calls = [
        item for item in human_trace if item["eventType"] == "MODEL_REQUEST_COMPLETED"
    ]  # type: ignore[union-attr]
    expect(
        status == 200 and len(model_calls) == 1,
        "completed model work repeated after approval",
    )

    print(
        f"M6_LIVE_SMOKE=PASS project={project_id} transform_run={run_id} approval_run={http_run} ssrf_run={private_run} cancellation_run={cancel_run} rag_run={rag_run} branch_run={branch_run} human_approval_run={human_run}"
    )


if __name__ == "__main__":
    main()
