# ADR 0005: Provenance-aware execution graph

## Context

Process trees do not prove agent delegation and parallel durations must not be summed.

## Alternatives

Flatten all processes; infer every process edge; preserve confidence per edge.

## Decision

Model recursive execution nodes and edges with confirmed/inferred/unavailable provenance.

## Consequences

The UI can show hierarchy without overstating certainty; aggregation requires edge/metric deduplication.

## Sources of a confirmed edge

An edge is confirmed only when the tool records it: Claude Code's `subagents/` folder, Codex `parent_thread_id`, OpenCode `parent_id`, and Orca's `tasks.parent_id` or `creator_dispatch_id`. An edge whose parent is not in the snapshot is dropped, and the child stays a root. Where the recorded parent is only an ancestor (a Claude Code subagent of a subagent), the edge is inferred.
