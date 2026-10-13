# Data model

The initial SQLite store persists immutable collector snapshots. The normalized in-memory domain contains `ObservedProcess`, `ExecutionNode`, status, source reliability, optional model/tokens, and optional parent relationship.

Future migrations split sessions, processes, executions, edges, events and metrics into separate tables. Optional fields remain null when unavailable; aggregates must deduplicate child metrics by metric provenance.
