# ADR 006: Immutable workflow versions

## Status

Accepted

## Decision

A workflow owns a mutable draft graph. Creating a version validates and copies that graph into `workflow_versions` with a monotonically increasing number. There is no update endpoint for a historical version, and runs always reference a version ID.

## Consequences

Every run is reproducible against a stable definition. Editing a draft requires a new version before execution changes. Removing a workflow cascades to versions and runs; runs restrict deletion of their referenced version.
