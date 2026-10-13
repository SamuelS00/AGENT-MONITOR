# Integration compatibility matrix

| Tool | Installed | Process discovery | Local session metadata | Model/tokens | Agent hierarchy |
| --- | --- | --- | --- | --- | --- |
| Codex CLI | yes | supported | rollout files in `~/.codex/sessions` and `archived_sessions` | model, cumulative tokens: confirmed per file; per process: inferred by working directory | not verified |
| Claude Code | yes | supported | transcripts in `~/.claude/projects/<cwd>` | model, tokens: inferred per process (working directory + recency), confirmed when the command line names the session id | not verified |
| OpenCode | yes | supported | SQLite `~/.local/share/opencode/opencode.db`, opened read-only | model, tokens (input + cache read/write, output + reasoning): inferred per process by working directory, confirmed when the command line names the session id; root sessions only | not verified |
| Gemini CLI | not detected | partial: name matching | unavailable | unavailable | unavailable |

“Partial” never means data is fabricated. New adapters must document a validated path, parser version and confidence level before enabling fields.

## Usage adapters (`src-tauri/src/adapters.rs`)

- Read-only. They extract the model name, token counters and timestamps; message content is never kept or returned.
- Claude Code: tokens in = input + cache creation + cache read, tokens out = output. A message logged once per content block is counted once (by message id).
- Codex: the last cumulative `total_token_usage` of the rollout file; model from the last `turn_context`.
- A transcript is paired with at most one process (same tool and working directory, written after the process started). Without a session id in the command line the pairing is `inferred`, and the UI shows it with `≈`.
- Process recognition uses the executable (or the script a launcher runs), never a substring of the command line, so desktop-app helper processes are not reported as agents.
- OpenCode: reads `session` rows (`directory`, `model`, `tokens_*`) from the local database with a read-only connection; message and part content is never selected. Model falls back to the last assistant message `modelID`. A session whose counters are all zero stays unavailable. Subagent sessions (`parent_id` set) are not paired with processes, and no delegation edge is inferred from them here.
- Gemini CLI: still unavailable until a real session file is inspected and documented.

## Usage breakdown fields

`provider`, `cacheReadTokens`, `cacheWriteTokens`, `reasoningTokens` and `costUsd` are optional and `null` when the source does not report them; they are never zero-filled. Cache tokens are a subset of `tokensIn`; reasoning tokens are a subset of `tokensOut`.

| Tool | provider | cache read/write | reasoning | cost |
| --- | --- | --- | --- | --- |
| Claude Code | unavailable (not recorded; not inferred from the model name) | `cache_read_input_tokens` / `cache_creation_input_tokens` | unavailable | unavailable |
| Codex | `model_provider` of `session_meta` | `cached_input_tokens` / `cache_write_input_tokens` | `reasoning_output_tokens` | unavailable |
| OpenCode | `providerID` of the session model, else of the last assistant message | `tokens_cache_read` / `tokens_cache_write` | `tokens_reasoning` | `session.cost`, as reported by OpenCode |
| Gemini CLI | unavailable | unavailable | unavailable | unavailable |

Cost is only what the tool itself records. The monitor never prices tokens.

Gemini CLI stays unsupported: no session file exists on the development machine, so the path and format are not validated. Enable it only after inspecting a real session and recording the path, parser version and confidence here.
