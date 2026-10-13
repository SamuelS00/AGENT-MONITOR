# Agent instructions

- Keep the monitor read-only: never alter observed processes, sessions, configuration, prompts, or credentials.
- Do not present unavailable data as zero or infer a delegation edge from process ancestry alone.
- Preserve source and reliability for every metric and relationship.
- Add adapters behind the domain contracts; do not couple the frontend to a CLI log format.
- Run `pnpm run check` and `cargo check --manifest-path src-tauri/Cargo.toml` before claiming validation.
- Do not commit databases, session files, credentials, or generated artifacts.
