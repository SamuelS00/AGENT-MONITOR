# Data model

The initial SQLite store persists immutable collector snapshots. The normalized in-memory domain contains `ObservedProcess` and `ExecutionNode` with status, source reliability, optional model/tokens, an optional parent relationship, a `role`, a `projectPath` and an optional `task` title.

- `role` is `session` for agent work and `service` for a background server that hosts sessions. A service owns no project.
- `projectPath` is the working directory the tool recorded (or the process started in). It is `null` when unknown; the UI then says "No working directory" instead of guessing.
- `parentId` is set only when a tool recorded the delegation (see `integrations.md`). Process ancestry alone is never used.
- Status is one of `running`, `waiting`, `idle`, `inactive`, `archived`, `completed`, `failed`, `disconnected` or `unknown`. `unknown` is reserved for a state that cannot be observed at all.
- Process command lines are stored sanitized: the executable name, flag names and a short list of known subcommands. Flag values and free text can hold prompts or credentials and are never persisted.

`ExecutionNode.sessionRef` is the tool's own session id. It is how stored history recognizes one session across snapshots even when it moves from a live process to files alone. History is derived on read from `collector_snapshots`; nothing separate is stored.

Future migrations split sessions, processes, executions, edges, events and metrics into separate tables. Optional fields remain null when unavailable; aggregates must deduplicate child metrics by metric provenance.
