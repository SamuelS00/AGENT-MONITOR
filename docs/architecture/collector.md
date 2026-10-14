# Collector

The collector uses local process inspection and a capability-scoped adapter layer. It is read-only, catches inaccessible paths, and returns a snapshot rather than controlling the observed CLI.

It combines three sources, each with its own reliability: recognized processes, the tools' own session stores (Codex rollouts, Claude Code transcripts, OpenCode sessions) and Orca's orchestration database. It records metadata only and deliberately does not retain prompt or conversation content. See `integrations.md` for what each adapter reads and how sessions, subagents and Orca workers are matched.

Polling is user-triggered in the MVP. A future periodic collector must use modest intervals, file watchers where supported, incremental cursors and persistence deduplication.
