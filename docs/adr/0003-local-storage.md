# ADR 0003: Local SQLite storage

## Context

History must survive restarts without cloud services.

## Alternatives

Browser storage; JSON files; local SQLite.

## Decision

Store collector snapshots locally in SQLite with versioned SQL migrations.

## Consequences

The data remains local/offline and later migrations can normalize it incrementally.
