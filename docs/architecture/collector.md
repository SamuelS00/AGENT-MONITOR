# Collector

The collector uses local process inspection and a capability-scoped adapter layer. It is read-only, catches inaccessible paths, and returns a snapshot rather than controlling the observed CLI. The first Codex adapter enumerates archived JSONL artifacts and records their metadata only. It deliberately does not parse or retain payload content.

Polling is user-triggered in the MVP. A future periodic collector must use modest intervals, file watchers where supported, incremental cursors and persistence deduplication.
