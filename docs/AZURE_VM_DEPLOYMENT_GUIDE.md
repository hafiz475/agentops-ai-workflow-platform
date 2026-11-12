# Azure VM deployment runbook - Milestone 5

Milestone 5 retains the VM and OIDC pipeline, starts the same six Compose services, and opens no new inbound ports. PostgreSQL now uses `pgvector/pgvector:pg16` so migration 0005 can enable vector storage while preserving the existing volume.

## Azure portal settings retained

- Resource group `rg-agentops-demo`, Central India
- Ubuntu 24.04 x64 VM `vm-agentops-demo`, Standard B2ls v2, Standard SSD
- SSH key authentication; no password
- NSG: TCP 22 only from the operator `/32`; TCP 3000 and 3001 from the internet
- Never add public rules for 5432, 6379, or 8000
- System-assigned identity, secure boot, vTPM, managed boot diagnostics
- Tags: `application=agentops-studio`, `environment=demo`, `milestone=5`

## Release command

The GitHub OIDC workflow invokes Azure Run Command. The VM checks out the exact commit and runs:

```bash
cd /opt/agentops-ai-workflow-platform
git fetch origin main
git checkout --detach "$DEPLOY_COMMIT"
docker compose up -d --build --remove-orphans
```

The Compose stack remains web (public 3000), API (public 3001), and private worker, AI service (8000), PostgreSQL (5432), and Redis (6379). No NSG change is required. Optional tool and provider secrets stay only in the VM environment.

## Verification

```bash
docker compose ps
docker compose logs --tail=100 worker
curl -fsS http://127.0.0.1:3000/
curl -fsS http://127.0.0.1:3001/health
curl -fsS http://127.0.0.1:3001/ready
```

Then verify the retained and new behaviors:

1. Run `INPUT -> PROMPT -> LLM -> OUTPUT`.
2. Pause and resume HUMAN_APPROVAL; confirm the completed LLM NodeRun is not repeated. Reject another approval and confirm cancellation.
3. Run CONDITION/TRANSFORM and a controlled public HTTP_REQUEST. Confirm the unselected branch is skipped and private/redirect SSRF attempts are blocked.
4. Create a development-embedding Knowledge Source, upload a synthetic engineering TXT document, and wait for `READY`.
5. Confirm chunks retain page/order provenance and provider/model metadata; vectors must not be returned.
6. Run `INPUT -> RETRIEVAL -> PROMPT -> LLM -> OUTPUT` with “What abnormal vibration was found?” Confirm the expected ranked source and retrieval traces.
7. Confirm controlled context reaches PROMPT, output completes, and `CITATIONS_VALIDATED` contains only retrieved source metadata.
8. From another project, attempt to reference the source and confirm validation rejects it.
9. Run Hit@K, Recall@K, and MRR evaluation cases through normal WorkflowRuns.

If `AI_OPENAI_API_KEY` is absent, use `development` / `development-hash-v1`. Do not claim OpenAI embedding execution unless it was actually observed. Optional OpenAI sources use `AI_OPENAI_EMBEDDING_MODEL` (default `text-embedding-3-small`).

## Budget and shutdown

Keep the existing Azure budget alerts. Stop/deallocate the VM when unused; stopping only the OS is still billable. Deleting `rg-agentops-demo` removes all resources and data and should only be done intentionally.
