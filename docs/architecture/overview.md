# Architecture overview

The Tauri Rust backend owns discovery, normalization, persistence and collection scheduling. React consumes only normalized Tauri commands. The UI never parses CLI logs.

`process discovery → adapter normalization → collector snapshot → SQLite → Tauri command/event → React UI`

The MVP performs a bounded refresh on demand. A later watcher/scheduler must retain this same read-only boundary and recover from partial files.
