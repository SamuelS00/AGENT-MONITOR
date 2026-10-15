# SPEC 005: Desktop interface

## Objective and scope

Provide Monitor, Execution Explorer (tree and graph), Timeline and Settings, plus History & Analytics when stored sessions exist, with a shared inspector and command palette. Visual rules live in `docs/design/design-system.md`.

## Requirements and rules

A screen is offered only when it can show something and is meant for the user. History & Analytics appears only when stored sessions exist. In live mode they are reconstructed by the backend from the stored snapshots (one session per root execution, matched across snapshots by the tool's own session id); a session that was live in one snapshot and absent from the next is `disconnected`, never `completed`. Snapshots older than 90 days are pruned. The design-system reference is a developer aid and is offered only with sample data. Shortcuts (⌘1…) follow the visible order. Settings holds facts and real options only: Tools (what each adapter observes), Data & privacy (what is read and kept, read-only) and Appearance (theme, density, pane sizes). A control that changes nothing must not be shown.

Monitor, Explorer and Timeline share one orchestration model (`src/model/orchestration.ts`). The Explorer is organized around orchestrations. Its session list puts orchestrations (a meta-orchestrator, or an Orca run without a coordinator) first, each described by what it holds ("2 orchestrators · 3 agents · 1 subagent · 1 retry") and when it last did anything, and plain sessions after them, so a one-row session never poses as an orchestration. Entries that would read the same carry a short id. A summary above the tree gives the outcome, the meta-orchestrator and its model, the counts, tokens and duration. Tries of one task are marked "try 1 of 2": certain when the tool recorded the retry (an Orca retry of the same task, from `retry_of_dispatch_id` or a second dispatch of one task), and marked "≈ try 1 of 2" when only the parent and name of Orca workers match, which is a guess because a coordinator that retries by starting a fresh task leaves no record; a failure that a later try replaced counts as a retry, not as an open failure. The Timeline repeats the summary above its rows and tags each row with its level and tries. The Monitor lists an orchestration first within its project, tagged "Orchestration" and described by its counts and retries; its state follows the outcome (an open failure shows as failed and appears under Needs attention, a failure a later try replaced does not), and a finished orchestration keeps its root's own status instead of being claimed completed. A session with no recorded orchestration level is an agent, never an orchestrator, and a root shows no "inferred" tag because it has no parent edge to infer.

Every node in the Explorer shows its orchestration level, model badge in the model's brand color, tokens and duration; the clock of a node that is not running stops at its last recorded activity.

Support dark/light system appearance, progressive disclosure and understandable empty/error states.

## Use cases and acceptance

As a developer, I can refresh local observations and inspect a selected execution. Acceptance: unavailable model/tokens visibly read “Unavailable”.

Live observations refresh every 15 seconds while the app is visible; a hidden window pauses scheduled refreshes and refreshes once when it becomes visible again. Sample data is never auto-refreshed.

## Dependencies

React, Lucide and Tauri commands.
