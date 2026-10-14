# ADR 0004: Metadata-only, read-only monitoring

## Context

Agent logs may contain prompts, source and credentials.

## Alternatives

Capture raw sessions; upload telemetry; collect only validated metadata.

## Decision

Operate locally, read-only, and avoid conversation payload capture by default.

## Consequences

Some rich fields remain unavailable until a safe, explicit adapter can expose them.

## Amendments

- Process command lines are persisted sanitized (executable, flag names, known subcommands); values and free text are dropped.
- Short, tool-recorded titles (Orca task title, Claude Code subagent description, OpenCode session title) are shown so users can see what an agent works on. They are capped at 140 characters. Task specs, objectives, results, prompts and message bodies remain off limits.
- A transcript may be searched for an identifier the tool injected (the Orca dispatch id) to prove which session a worker ran. The bytes are only matched, never stored.
