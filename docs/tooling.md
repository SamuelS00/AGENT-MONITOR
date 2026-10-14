# Development tooling

This page lists the quality tooling adopted by the repository, what each tool enforces, how to run it locally, and where it is checked automatically. The goal is the same one stated in `AGENTS.md` and `CONTRIBUTING.md`: validation should be reproducible, not dependent on reviewer discipline.

## Summary table

| Area                       | Tool                                     | Configuration                                  | Local command                                                                    | Enforcement                                                                 |
| -------------------------- | ---------------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Type safety                | TypeScript 5.7 (`tsc`)                   | `tsconfig*.json`                               | `pnpm run check`                                                                 | CI, required before review                                                  |
| JS/TS linting              | ESLint 10 + typescript-eslint            | `eslint.config.js`                             | `pnpm run lint` / `pnpm run lint:fix`                                            | CI + pre-commit (lint-staged)                                               |
| Formatting (frontend/docs) | Prettier 3                               | `.prettierrc.json`, `.prettierignore`          | `pnpm run format` / `pnpm run format:check`                                      | CI + pre-commit (lint-staged)                                               |
| Frontend unit tests        | Vitest 5 + React Testing Library (jsdom) | `vite.config.ts` (`test`), `src/test-setup.ts` | `pnpm run test` / `pnpm run test:watch` / `pnpm run test:coverage`               | CI                                                                          |
| Coverage                   | `@vitest/coverage-v8`                    | `vite.config.ts`                               | `pnpm run test:coverage`                                                         | Report only (not a gate yet)                                                |
| Rust formatting            | rustfmt                                  | `src-tauri/rustfmt.toml`                       | `cargo fmt --manifest-path src-tauri/Cargo.toml`                                 | CI (`--check`)                                                              |
| Rust linting               | Clippy                                   | `[lints]` in `src-tauri/Cargo.toml`            | `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` | CI (`-D warnings`); `[lints]` also surfaces warnings in plain `cargo check` |
| Rust unit tests            | `cargo test`                             | —                                              | `cargo test --manifest-path src-tauri/Cargo.toml`                                | CI                                                                          |
| Commit messages            | commitlint (Conventional Commits)        | `commitlint.config.js`                         | automatic                                                                        | commit-msg hook (Husky)                                                     |
| Git hooks                  | Husky 9                                  | `.husky/` (`prepare` script installs)          | automatic after `pnpm install`                                                   | pre-commit + commit-msg                                                     |
| Staged-file checks         | lint-staged 17                           | `lint-staged` key in `package.json`            | automatic                                                                        | pre-commit hook                                                             |
| CI                         | GitHub Actions                           | `.github/workflows/ci.yml`                     | —                                                                                | every push to `main` and every pull request                                 |

## Frontend

- **ESLint** uses the flat-config format (`eslint.config.js`) with `@eslint/js` recommended rules, `typescript-eslint` recommended rules, and the `react-hooks` and `react-refresh` plugins. Run `pnpm run lint` before opening a review; `pnpm run lint:fix` applies safe autofixes.
- **Prettier** owns all formatting for JS/TS/CSS/Markdown/JSON (print width 140, double quotes, trailing commas). The `src-tauri` directory is excluded because Rust formatting is owned by rustfmt. `pnpm run format:check` is what CI runs; `pnpm run format` rewrites files.
- **Vitest** runs component and unit tests in a jsdom environment. Configuration lives in `vite.config.ts` and the test bootstrap in `src/test-setup.ts` (jest-dom matchers, a passive `matchMedia` stub — jsdom does not implement it — and explicit React Testing Library cleanup, since Vitest runs without global APIs). Existing coverage:
  - `src/monitor.test.ts` — Tauri command bindings call the right backend commands, propagate failures, and detect the Tauri runtime.
  - `src/model/live.test.ts` — the collector-to-UI adapter keeps the product invariant from `AGENTS.md`: missing model/tokens stay unavailable (never zero), confirmed usage carries its source, inferred relationships get an explicit note.
  - `src/model/tree.test.ts` — usage rollups count each agent's own usage exactly once, flag partial sums, and never invent end times.
  - `src/App.test.tsx` — the shell renders collector data, shows "Unavailable" for model/tokens it cannot verify, surfaces collector errors, refreshes through the collector command, and labels the sample dataset as "Sample data" outside Tauri.

All test fixtures are synthetic and labeled with a `fixture-` prefix (or the word "fixture"), as required by `CONTRIBUTING.md`. No test depends on real session data.

## Rust (`src-tauri`)

- **rustfmt** settings live in `src-tauri/rustfmt.toml` (edition 2021, max width 120). `cargo fmt` rewrites; CI fails on unformatted code.
- **Clippy** is configured in two layers:
  - `[lints.rust] unsafe_code = "forbid"` — the monitor must stay read-only and audit-friendly.
  - `[lints.clippy] all = "warn"` — visible during every local `cargo check`.
  - CI additionally runs `cargo clippy --all-targets -- -D warnings`, so any lint (including the table above) fails the build.
- Domain enum variants that are part of the data contract but not yet produced by any adapter carry an explicit `#[allow(dead_code)]` with a comment in `domain.rs`; they must not be deleted to silence a warning.

## Commits and hooks

- **Conventional Commits** (`feat:`, `fix:`, `docs:`, `test:`, `chore:`, …) are enforced by commitlint with `@commitlint/config-conventional`. The commit-msg hook rejects non-conforming messages — the convention documented in `CONTRIBUTING.md` is now machine-checked.
- **Husky** is installed via the `prepare` script (`pnpm install` wires it up automatically). Hooks live in `.husky/`; the `.husky/_` directory is generated and gitignored.
  - `pre-commit` runs lint-staged: ESLint autofix + Prettier on staged `*.{js,ts,tsx}` and Prettier on staged `*.{css,md,json}`.
  - `commit-msg` runs commitlint against the commit message.
- Hooks can be skipped locally with `--no-verify`, but CI runs the same checks, so bypassing only defers the failure.

## Continuous integration

`.github/workflows/ci.yml` runs on every push to `main` and every pull request, in two parallel jobs:

- **frontend** (ubuntu) — `pnpm run check`, `pnpm run lint`, `pnpm run format:check`, `pnpm run test`, with the pnpm store cached.
- **rust** (macOS, the platform this app targets) — `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test`, with `Swatinem/rust-cache` for build artifacts.

The CI job matrix intentionally mirrors the "Validation" commands in `README.md`; if you change those commands, update `README.md`, `CONTRIBUTING.md`, this page, and the workflow together.
