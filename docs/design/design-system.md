# Agent Monitor design system

Status: implemented in `src/styles/` and `src/ui/`. A live reference renders at **Design System** in the sidebar (`⌘K → "Go to Design System"`).

## 1. Direction

A quiet, native-feeling macOS tool for reading what AI agents are doing right now.

- **Tone** from Claude Desktop: warm neutrals, a single clay accent, system typography.
- **Structure** from Linear: dense rows, a strong list/inspector rhythm, keyboard everywhere.
- **Telemetry** from OrbStack: states and numbers first, ornament never.
- **Navigation** from Things 3 and **speed** from Raycast: persistent sidebar, `⌘K` palette, visible shortcuts.

### Principles

1. **Evidence over decoration.** Every value says where it came from (confirmed, estimated, unavailable).
2. **Lists before cards.** Rows, trees and tables carry data. No floating KPI cards.
3. **Color is a second channel.** Status = glyph shape + word + color. Accent = selection and focus only.
4. **Read-only, visibly.** No control implies it can change an observed process, session or config.
5. **Native density.** 13px base, 28px rows (24px compact), 4px grid, 3–10px radii, no shadows except popovers.
6. **Keyboard first.** Every list navigable with arrows; every action reachable from the palette.

## 2. Tokens (`src/styles/tokens.css`)

Components consume **semantic** tokens only. Never write a hex value in a component.

| Group   | Tokens                                                                                                      |
| ------- | ----------------------------------------------------------------------------------------------------------- |
| Surface | `--surface-sidebar/content/raised/inspector/sunken`, `--surface-hover/active/selected/selected-inactive`    |
| Line    | `--line-subtle/default/strong`                                                                              |
| Text    | `--text-primary/secondary/tertiary/on-accent` (tertiary is for metadata, never the only carrier of meaning) |
| Accent  | `--accent`, `--accent-solid`, `--accent-ring`                                                               |
| Status  | `--status-{running,waiting,failed,completed,disconnected,idle,unknown}` plus `*-bg` tints                   |
| Type    | `--font-sans` (SF Pro via system), `--font-mono` (SF Mono); `--fs-2xs…xl` = 10.5 / 11 / 12 / 13 / 15 / 20   |
| Space   | `--sp-0…6` = 2 / 4 / 6 / 8 / 12 / 16 / 24                                                                   |
| Radius  | `--r-xs/sm/md/lg` = 3 / 5 / 7 / 10                                                                          |
| Motion  | `--dur-fast` 90ms, `--dur` 160ms, `--ease` cubic-bezier(.2,.8,.2,1)                                         |

Light is the default (warm paper neutrals). Dark overrides the same names under `:root[data-theme="dark"]`; JS resolves "System" to light/dark and writes `data-theme`. Density is `data-density="compact"` and only changes `--row-h`.

Monospace is for technical strings: model ids, ids, paths, numbers (tabular figures).

## 3. Status and reliability

| Status         | Glyph                          | Meaning                                     |
| -------------- | ------------------------------ | ------------------------------------------- |
| running        | filled dot with pulsing ring   | actively executing                          |
| waiting        | half-filled circle             | blocked on approval, input or another agent |
| completed      | check                          | finished normally                           |
| failed         | filled rounded square with ✕   | ended with an error                         |
| disconnected   | dashed circle                  | process lost; final state unknown           |
| idle / unknown | hollow circle / hollow diamond | alive but quiet / undetermined              |

Data reliability mirrors `SourceReliability` in `src/types.ts`:

| Value                | Rendering                                              | Rule                                     |
| -------------------- | ------------------------------------------------------ | ---------------------------------------- |
| confirmed            | plain                                                  | read from the tool's own record          |
| inferred / estimated | `≈` prefix + dotted underline                          | derived; tooltip names the source        |
| unavailable          | `—` in tables, the word "Unavailable" in the inspector | **never** shown as 0                     |
| lower bound          | `≥` prefix                                             | a sum where some members are unavailable |

Relationships: confirmed delegation draws a solid guide line; an inferred edge draws a dotted line plus an `inferred` tag. **Process ancestry alone is never rendered as delegation.**

Token rollups sum each agent's _own_ usage once (`rollupTokens` in `src/model/tree.ts`). Parents never include child usage, so nothing is double counted.

## 4. Components

| Component                              | File                    | Variants / states                                                             |
| -------------------------------------- | ----------------------- | ----------------------------------------------------------------------------- |
| `StatusGlyph`                          | `ui/primitives.tsx`     | 7 statuses, optional label                                                    |
| `Val`                                  | same                    | confirmed, estimated, unavailable, lower bound, `verbose`                     |
| `Segmented`                            | same                    | on/off, with icons                                                            |
| `Menu` / `useMenu`                     | same                    | context menu and anchored picker, keyboard nav, checked, disabled, separators |
| `Banner`, `EmptyState`, `SkeletonRows` | same                    | info/warn/error; empty; loading                                               |
| `Resizer`                              | same                    | drag, double-click to reset                                                   |
| `Sidebar`, `Toolbar`                   | `ui/Shell.tsx`          | resizable sidebar (172–320), drag region, `⌘\` collapse                       |
| `Inspector`                            | `ui/Inspector.tsx`      | agent, history session, empty; resizable (260–560)                            |
| `CommandPalette`                       | `ui/CommandPalette.tsx` | `⌘K`; views, actions, agents                                                  |
| Tree rows                              | `views/Explorer.tsx`    | default, hover, selected, selected-unfocused, collapsed, parallel, inferred   |
| Graph node                             | `views/Graph.tsx`       | status, selected, inferred (dashed), collapsed count                          |

Row states: hover = `--surface-hover`; selected = `--surface-selected` when the list has focus, `--surface-selected-inactive` otherwise. Focus ring = `--accent-ring`.

## 5. Screens

1. **Monitor** (`⌘1`): active sessions grouped by project; scope filter (Active / Needs attention / All); attention states sort first.
2. **Execution Explorer** (`⌘2`): recursive tree (default) or orchestration graph; session picker; expand/collapse all; `∥` marks concurrent siblings; `N parallel` on parents with ≥2 running children.
3. **Timeline** (`⌘3`): per-agent bars on a shared clock, hatched wait spans, concurrency strip, "now" line.
4. **History & Analytics** (`⌘4`): searchable, sortable sessions; tokens/day; breakdown by project, model or tool. Sessions without usage data are listed but excluded from sums, and the UI says so.
5. **Settings** (`⌘5`): detected tools with per-capability reliability, integrations, permissions, privacy, appearance.

Selecting any node anywhere updates the shared inspector (`⌘I`). `↵` on a Monitor row opens it in the Explorer.

## 6. Implementation rules

- Frontend reads **only** the UI model in `src/model/types.ts`. CLI-specific parsing belongs in adapters behind the domain contracts in `src/types.ts` and `src-tauri/src/domain.rs`; `src/model/live.ts` is the only mapper from the collector snapshot.
- Anything that can be missing is a `Metric<T>` and is rendered with `Val`. Do not write `?? 0`.
- Sample data lives in `src/model/fixtures.ts`, is the default only when not running inside Tauri, and always shows a **Sample data** chip in the toolbar.
- Add a status or reliability value in one place (`model/status.ts`, `tokens.css`, `StatusGlyph`) and update the Design System page.
- Window chrome: `titleBarStyle: Overlay`; the toolbar is `data-tauri-drag-region`; the Tauri capability grants `core:window:allow-start-dragging` and only the notification permission-check, permission-request and delivery commands beyond core defaults. It grants no filesystem, shell or process permissions.

## 7. Guidelines for AI agents extending the UI

1. Read this file and `AGENTS.md` first. The monitor is read-only; do not add controls that act on observed processes.
2. Reuse a component before creating one. If you must add one, add it to the Design System page with all its states.
3. No raw colors, no new font sizes, no radius above `--r-lg`. No gradients, glass, emoji, decorative icons or per-tool brand colors.
4. Do not add KPI cards or charts unless they answer a question a table cannot. Charts must show unavailable data as a gap, not zero.
5. Every list needs: empty state, loading state, error state, keyboard navigation, context menu where actions exist, and selection wired to the inspector.
6. New status/reliability treatments must work in greyscale (shape + text).
7. Run `pnpm run check` and `cargo check --manifest-path src-tauri/Cargo.toml` before claiming validation, and look at light **and** dark at 1180×780 and at the 920px minimum width.
