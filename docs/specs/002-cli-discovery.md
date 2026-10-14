# SPEC 002: CLI discovery

## Objective and scope

Detect installed/active recognized CLI processes on macOS; excludes executing a CLI to create telemetry.

## Requirements and rules

Capture PID, start time, executable/command and working directory when available. PID plus start time identifies an observation.

## Use cases and acceptance

As a developer, I can refresh and see a running Codex/Claude/OpenCode process. Acceptance: unknown processes are omitted and permissions failures are non-fatal.

## Dependencies

Rust process inspection and the adapter capability matrix.
