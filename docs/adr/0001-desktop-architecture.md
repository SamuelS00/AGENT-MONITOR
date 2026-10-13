# ADR 0001: Tauri desktop architecture

## Context
The monitor must run locally on macOS with a native collector and a modern UI.

## Alternatives
Electron with Node collection; native Swift UI; Tauri with Rust and React.

## Decision
Use Tauri 2, Rust and React/Vite.

## Consequences
Collection remains native and local; contributors need Rust plus Node tooling.
