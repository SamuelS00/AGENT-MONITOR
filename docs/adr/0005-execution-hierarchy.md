# ADR 0005: Provenance-aware execution graph

## Context

Process trees do not prove agent delegation and parallel durations must not be summed.

## Alternatives

Flatten all processes; infer every process edge; preserve confidence per edge.

## Decision

Model recursive execution nodes and edges with confirmed/inferred/unavailable provenance.

## Consequences

The UI can show hierarchy without overstating certainty; aggregation requires edge/metric deduplication.
