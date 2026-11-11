# Azure VM deployment runbook � Milestone 3

This runbook now covers Milestone 4. The VM and OIDC pipeline remain unchanged; the release starts the same six Compose services and opens no new inbound ports.

## Azure portal settings retained

- Resource group `rg-agentops-demo`, Central India
- Ubuntu 24.04 x64 VM `vm-agentops-demo`, Standard B2ls v2, Standard SSD
- SSH key authentication; no password
- NSG: TCP 22 only from the operator `/32`; TCP 3000 and 3001 from the internet
- Never add public rules for 5432, 6379, or 8000
- System-assigned identity, secure boot, vTPM, managed boot diagnostics
- Tags: `application=agentops-studio`, `environment=demo`, `milestone=4`

## Release command

The GitHub OIDC workflow invokes Azure Run Command. The VM checks out the exact commit and runs:

```bash
cd /opt/agentops-ai-workflow-platform
git fetch origin main
git checkout --detach "$DEPLOY_COMMIT"
docker compose up -d --build --remove-orphans
```

The Compose stack is now:

```text
web (public 3000)
api (public 3001)
worker (private)
ai-service (private 8000)
postgres (private 5432)
redis (private 6379, append-only persistence)
```

## Verification

```bash
docker compose ps
docker compose logs --tail=100 worker
curl -fsS http://127.0.0.1:3000/
curl -fsS http://127.0.0.1:3001/health
curl -fsS http://127.0.0.1:3001/ready
```

Then smoke-test from the UI:

1. Run `INPUT -> PROMPT -> LLM -> OUTPUT` and confirm completion.
2. Run a version containing HUMAN_APPROVAL and confirm `WAITING_FOR_APPROVAL`.
3. Approve it from Approvals; confirm resume and that LLM has one completed NodeRun.
4. Repeat and reject; confirm `CANCELLED` / `HUMAN_REJECTED`.
5. Cancel a queued or waiting run.
6. Launch an evaluation and confirm its case WorkflowRuns complete.
7. Review `WORKER_CLAIMED_RUN`, approval, resume, retry/cancel, and completion trace events.
8. Run a CONDITION workflow and confirm only one branch completes while the other has `SKIPPED` NodeRuns.
9. Run TRANSFORM and a controlled public HTTP_REQUEST; confirm bounded response metadata and no sensitive headers in traces.
10. Attempt `http://127.0.0.1` and a redirect to a private address; confirm `HTTP_REQUEST_BLOCKED` and a failed run.

No NSG change is required: HTTP tools make outbound requests from the private worker. Do not expose worker, AI, PostgreSQL, or Redis ports. Optional tool secrets belong only in the VM `.env` as project-scoped `TOOL_SECRETS_JSON`; never put secret values in workflow JSON or GitHub variables.

## Budget and shutdown

Keep the existing Azure budget alerts. Stop/deallocate the VM when the demo is unused; stopping only the OS is still billable. Deleting `rg-agentops-demo` removes all resources and data and should only be done intentionally.
