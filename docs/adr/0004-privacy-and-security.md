# ADR 0004: Metadata-only, read-only monitoring

## Context

Agent logs may contain prompts, source and credentials.

## Alternatives

Capture raw sessions; upload telemetry; collect only validated metadata.

## Decision

Operate locally, read-only, and avoid conversation payload capture by default.

## Consequences

Some rich fields remain unavailable until a safe, explicit adapter can expose them.
