# ADR 021: Persisted human approval pause and resume

## Status

Accepted

## Decision

HUMAN_APPROVAL creates one ApprovalRequest, sets node `WAITING` and run `WAITING_FOR_APPROVAL`, and ends the job. Approval queues a new resume job; rejection cancels. Reviewer identity remains nullable with `demo-reviewer` until authentication exists.

## Consequences

No worker remains blocked on a person. Decisions and resume behavior survive restarts without pretending demo identity is authenticated.
