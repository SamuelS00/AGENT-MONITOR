# Contributing

Use small conventional commits (`feat:`, `fix:`, `docs:`, `test:`, `chore:`) and branches named `feature/<topic>` or `fix/<topic>`. Commit messages are checked by commitlint on every commit, and staged files are linted and formatted automatically by lint-staged. Keep adapter capability changes documented in `docs/architecture/integrations.md`.

Before opening a review, run the validation commands from the README — CI runs the same matrix (type-check, lint, format, tests for the frontend; rustfmt, clippy with `-D warnings`, and tests for Rust). See `docs/tooling.md` for the full list of tools.

Tests and fixtures must label synthetic data clearly; the app UI must remain sourced from real collector data. Never present unavailable metrics as zero or delete domain contract values just to silence a lint — document them instead.
