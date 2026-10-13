# Roadmap

1. **Foundation (current):** process discovery, snapshots, SQLite, minimal desktop UI, Codex artifact metadata.
2. **Reliable adapters:** validate session schemas/hooks for Codex, Claude Code and OpenCode; add incremental readers and provenance.
3. **Execution graph:** confirmed parent-child edges, cycle protection, event timeline and history queries.
4. **Product polish:** configurable retention, tray/closed-window behavior, accessible UI and optional analytics built only on verified data.

## Open items

- **Gemini CLI adapter (open, revisit later):** model/usage are unavailable because no real session file has been validated (none exists on the development machine). Install the CLI, produce a session, inspect it, then record path, parser version and confidence in `docs/architecture/integrations.md` before enabling fields. Related: Antigravity (`~/.gemini/antigravity`, protobuf) and Copilot have no validated usage source.
- **Reasoning effort for Claude Code:** transcripts do not record it, so the effort badge is unavailable for that tool.

No cloud synchronization, automatic launch, remote control or paid service is planned without explicit approval.
