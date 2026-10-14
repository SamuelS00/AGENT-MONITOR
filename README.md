# Agent Monitor

Local, read-only macOS desktop monitor for CLI-based AI agent activity. The MVP discovers recognized local processes, records source-aware snapshots in SQLite, and presents executions without inventing unavailable models, token counts, or agent relationships.

## Current status

Implemented: Tauri/React foundation, local process discovery for Codex, Claude Code, OpenCode and Gemini CLI names, SQLite snapshot persistence, and read-only adapters for Codex, Claude Code and OpenCode sessions and for Orca orchestration runs. Sessions, subagents and Orca workers are listed with their project, status, model and usage. Model, tokens, and parent-child delegation are displayed only when a verified adapter can provide them, and each carries its source and reliability. See `docs/architecture/integrations.md`.

## Development

Prerequisites: macOS Command Line Tools, Rust stable (with `rustfmt` and `clippy` components), Node.js 20.19+ and pnpm.

```sh
pnpm install
pnpm tauri dev
```

Installing dependencies also wires up the Git hooks (Husky): staged files are linted/formatted on commit and commit messages must follow Conventional Commits.

Validation (the same checks CI runs, see `docs/tooling.md`):

```sh
pnpm run check        # TypeScript
pnpm run lint         # ESLint
pnpm run format:check # Prettier
pnpm run test         # Vitest
pnpm run validate     # check + lint + format:check + test + build
cargo check --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo test --manifest-path src-tauri/Cargo.toml
```

## Privacy

The collector is local and read-only. It does not send session data anywhere, does not read prompts or conversation content, and stores process command lines without flag values or free text. Short titles the tools recorded themselves are shown as "what an agent is working on". See `docs/architecture/collector.md` and ADR 0004.
