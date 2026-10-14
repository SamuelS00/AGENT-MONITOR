# SPEC 005: Desktop interface

## Objective and scope

Provide Monitor, Execution Explorer (tree and graph), Timeline and Settings, plus History & Analytics when stored sessions exist, with a shared inspector and command palette. Visual rules live in `docs/design/design-system.md`.

## Requirements and rules

A screen is offered only when it can show something and is meant for the user. History & Analytics appears only when stored sessions exist. In live mode they are reconstructed by the backend from the stored snapshots (one session per root execution, matched across snapshots by the tool's own session id); a session that was live in one snapshot and absent from the next is `disconnected`, never `completed`. Snapshots older than 90 days are pruned. The design-system reference is a developer aid and is offered only with sample data. Shortcuts (⌘1…) follow the visible order. Settings holds facts and real options only: Tools (what each adapter observes), Data & privacy (what is read and kept, read-only) and Appearance (theme, density, pane sizes). A control that changes nothing must not be shown.

Every node in the Explorer shows its orchestration level, model badge in the model's brand color, tokens and duration; the clock of a node that is not running stops at its last recorded activity.

Support dark/light system appearance, progressive disclosure and understandable empty/error states.

## Use cases and acceptance

As a developer, I can refresh local observations and inspect a selected execution. Acceptance: unavailable model/tokens visibly read “Unavailable”.

## Dependencies

React, Lucide and Tauri commands.
