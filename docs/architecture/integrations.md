# Integration compatibility matrix

| Tool        | Installed    | Process discovery      | Local session store                                            | Model/tokens                                                                                                                        | Agent hierarchy (confirmed by)                                |
| ----------- | ------------ | ---------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Codex CLI   | yes          | supported              | rollouts in `~/.codex/sessions` and `archived_sessions`        | confirmed per rollout; per process inferred by working directory                                                                    | `parent_thread_id` in `session_meta`                          |
| Claude Code | yes          | supported              | transcripts in `~/.claude/projects/<project>/<session>.jsonl`  | confirmed per transcript; per process inferred by working directory, confirmed when the command names the session (`--resume <id>`) | `<session>/subagents/agent-*.jsonl` written by Claude Code    |
| OpenCode    | yes          | supported              | SQLite `~/.local/share/opencode/opencode.db`, opened read-only | confirmed per session; per process inferred by working directory                                                                    | `parent_id` column of the `session` table                     |
| Orca        | yes          | not a CLI agent        | SQLite `~/Library/Application Support/orca/orchestration.db`   | none recorded by Orca; the model and usage come from the worker's own session (see below)                                           | `tasks.parent_id` and `dispatch_contexts.creator_dispatch_id` |
| Gemini CLI  | not detected | partial: name matching | unavailable                                                    | unavailable                                                                                                                         | unavailable                                                   |

“Partial” never means data is fabricated. New adapters must document a validated path, parser version and confidence level before enabling fields.

## Usage adapters (`src-tauri/src/adapters.rs`)

- Read-only. They extract the model name, token counters, timestamps and the short titles listed under "What an agent is working on"; message content is never kept or returned.
- Claude Code: tokens in = input + cache creation + cache read, tokens out = output. A message logged once per content block is counted once (by message id).
- Codex: the last cumulative `total_token_usage` of the rollout file; model from the last `turn_context`.
- A transcript is paired with at most one process (same tool and working directory, written after the process started). Without a session id in the command line the pairing is `inferred`, and the UI shows it with `≈`.
- Process recognition uses the name the process was started as (`argv[0]`), or the script a launcher runs, never a substring of the command line. Desktop-app helpers are not agents, and neither are workers a CLI re-executes from its own binary (Claude Code runs `ugrep` that way).
- A launcher (`node codex.js`) and the native binary it starts count as one agent: the launcher is dropped when a same-tool process in the same directory names it as its parent. This is de-duplication, not a delegation edge.
- A session id named on the command line (`--resume <id>`) reserves that transcript for its process; another process in the same directory cannot take it by the newest-file heuristic.
- OpenCode: reads `session` rows (`directory`, `model`, `tokens_*`) from the local database with a read-only connection; message and part content is never selected. Model falls back to the last assistant message `modelID`. A session whose counters are all zero stays unavailable. Optional columns (`agent`, `time_archived`, `title`) are used only when the database has them.
- Gemini CLI: still unavailable until a real session file is inspected and documented.

## Codex thread index

Codex also keeps an index, `~/.codex/state_<n>.sqlite` (the highest `<n>`), opened read-only. From `threads` it reads the name the user set (the generated `title` is the first words of the prompt and is not read), cumulative tokens, archive state, model and effort; the first user message and preview columns hold prompt text and are never selected. `thread_spawn_edges` gives delegations the tool recorded, which become confirmed parent edges. A thread the index lists but whose rollout is missing is shown from the index alone, with one cumulative token count and no input/output split.

## Sessions without a process

The desktop apps host many sessions behind one server process (`codex app-server`, `codex exec-server`, `opencode serve`), whose own working directory says nothing about them. These servers are `role: service`, grouped as "Background services", and own no project. Sessions are listed from the tools' own stores instead, for the last 24 hours (at most 30 per tool): Codex rollouts, OpenCode sessions and Claude Code transcripts, each with the working directory the tool recorded. A session already owned by a live process is not listed twice.

## Status

Status comes from evidence, never from the clock alone:

| Status      | Meaning                                                                                              |
| ----------- | ---------------------------------------------------------------------------------------------------- |
| Running     | A live process with recent activity, or a session file written in the last 2 minutes                 |
| Idle        | A live process, or a live host, with no recent activity (up to 30 minutes for process-less sessions) |
| Needs input | Blocked on another agent or on a dispatch that has not started (Orca)                                |
| Stopped     | No live process observed and nothing written recently. It does not say whether the session finished  |
| Archived    | The tool itself archived the session (Codex `archived_sessions`, OpenCode `time_archived`)           |
| Completed   | Only where the tool records completion (Orca)                                                        |
| Failed      | Only where the tool records failure (Orca)                                                           |

The UI stops the clock of any node that is not running or waiting at its last recorded activity and marks the value as estimated.

## What an agent is working on

The `task` field carries a short title the tool recorded itself, capped at 140 characters with whitespace collapsed: the Orca task title, the Claude Code subagent `description` of its `.meta.json`, and the OpenCode session title (its "New session - ..." placeholder is ignored). Task specs, objectives, results, prompts and message bodies are never read.

## Orca

`orchestration.db` is opened read-only. Only identifiers, states, depth, timestamps, task titles, the worktree and the launched agent are selected.

- A run is the root; each dispatch is a worker under it.
- A worker hangs under the worker that created it when `creator_dispatch_id` names another assignee, else under the dispatch of its parent task (`tasks.parent_id`, set by `worker-start --parent`), else under its run. Orca 1.4 fences dispatched workers from starting workers, so the coordinator records orchestrator → agent structure through `--parent`.
- Task dependencies (`deps`) are ordering, not delegation, and are not shown as edges.
- Orca records no model or tokens. A worker is matched to its real session by evidence: the same agent and worktree, a transcript written since the dispatch started, and one that **opens** with the dispatch id Orca injects in the worker prompt, meaning the id is in one of the first 20 lines. Position in lines, not bytes, is what matters: Codex rollouts begin with a very large `session_meta` line, and a coordinator's transcript also contains the id, but only far later in command output. The match is confirmed, and the model, tokens and subagents of that session are shown on the worker. The transcript is only searched for the id; nothing from it is kept. If a live process owns that session, its node is folded into the worker.
- The meta-orchestrator is the session that issued the run: a transcript or rollout (Claude Code or Codex, never a worker's own) written in the run's worktree since it began whose text names the run id. The coordinator names the id the instant it creates the run, while a session that only inspects the run later names it later, so the candidate whose first mention is earliest wins. It is confirmed when it leads the runner-up by more than 30 seconds, or is the only candidate; otherwise the edges to its orchestrators are marked inferred. When no such session is found, the run itself stays the root.
- Levels come from the recorded structure: the meta-orchestrator above, an Orca worker with workers is an orchestrator, any other Orca worker is an agent, and a native subagent is a subagent.

## Usage breakdown fields

`provider`, `cacheReadTokens`, `cacheWriteTokens`, `reasoningTokens` and `costUsd` are optional and `null` when the source does not report them; they are never zero-filled. Cache tokens are a subset of `tokensIn`; reasoning tokens are a subset of `tokensOut`.

| Tool        | provider                                                              | cache read/write                                          | reasoning                 | cost                                    |
| ----------- | --------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------- | --------------------------------------- |
| Claude Code | unavailable (not recorded; not inferred from the model name)          | `cache_read_input_tokens` / `cache_creation_input_tokens` | unavailable               | unavailable                             |
| Codex       | `model_provider` of `session_meta`                                    | `cached_input_tokens` / `cache_write_input_tokens`        | `reasoning_output_tokens` | unavailable                             |
| OpenCode    | `providerID` of the session model, else of the last assistant message | `tokens_cache_read` / `tokens_cache_write`                | `tokens_reasoning`        | `session.cost`, as reported by OpenCode |
| Gemini CLI  | unavailable                                                           | unavailable                                               | unavailable               | unavailable                             |

Cost is only what the tool itself records. The monitor never prices tokens.

Gemini CLI stays unsupported: no session file exists on the development machine, so the path and format are not validated. Enable it only after inspecting a real session and recording the path, parser version and confidence here.
