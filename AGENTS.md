# Agent instructions

- Keep the monitor read-only: never alter observed processes, sessions, configuration, prompts, or credentials.
- Do not present unavailable data as zero or infer a delegation edge from process ancestry alone.
- Preserve source and reliability for every metric and relationship.
- Add adapters behind the domain contracts; do not couple the frontend to a CLI log format.
- Run `pnpm run check` and `cargo check --manifest-path src-tauri/Cargo.toml` before claiming validation.
- Do not commit databases, session files, credentials, or generated artifacts.

# Workflow

- After finishing each item, validate it, commit it (Conventional Commits, one logical change per commit), push to the current branch and move straight to the next item without stopping.
- Interrupt the sequence only when a decision is genuinely the user's to make or a validation fails and cannot be fixed.
