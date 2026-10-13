# Integration compatibility matrix

| Tool | Installed | Process discovery | Local session metadata | Model/tokens | Agent hierarchy |
| --- | --- | --- | --- | --- | --- |
| Codex CLI | yes | supported | rollout files in `~/.codex/sessions` and `archived_sessions` | model, cumulative tokens: confirmed per file; per process: inferred by working directory | not verified |
| Claude Code | yes | supported | transcripts in `~/.claude/projects/<cwd>` | model, tokens: inferred per process (working directory + recency), confirmed when the command line names the session id | not verified |
| OpenCode | yes | supported | not verified | not verified | not verified |
| Gemini CLI | not detected | partial: name matching | unavailable | unavailable | unavailable |

“Partial” never means data is fabricated. New adapters must document a validated path, parser version and confidence level before enabling fields.

## Usage adapters (`src-tauri/src/adapters.rs`)

- Read-only. They extract the model name, token counters and timestamps; message content is never kept or returned.
- Claude Code: tokens in = input + cache creation + cache read, tokens out = output. A message logged once per content block is counted once (by message id).
- Codex: the last cumulative `total_token_usage` of the rollout file; model from the last `turn_context`.
- A transcript is paired with at most one process (same tool and working directory, written after the process started). Without a session id in the command line the pairing is `inferred`, and the UI shows it with `≈`.
- Process recognition uses the executable (or the script a launcher runs), never a substring of the command line, so desktop-app helper processes are not reported as agents.
