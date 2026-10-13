# Implementation plan

## Completed in the bootstrap

- Clone and initialize project structure.
- Record environment and integration compatibility findings.
- Create Tauri/Rust domain, collector, SQLite migration and read-only commands.
- Create a React monitor/explorer/details UI using real collector data.
- Add ADRs, specs and contribution guidance.

## Next verified increments

1. Install/validate Rust toolchain and run `cargo check`.
2. Add Rust unit tests for process normalization and hierarchy fixtures.
3. Validate documented local formats for each installed CLI without reading prompt payloads.
4. Add scheduled refresh/file watching with deduplication and error telemetry stored locally.
5. Add history queries and app lifecycle/tray configuration behind user settings.
