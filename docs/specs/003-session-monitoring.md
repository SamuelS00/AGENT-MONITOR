# SPEC 003: Session monitoring

## Objective and scope

Persist local snapshots and safely expose validated local session metadata; excludes raw prompt capture.

## Requirements and rules

Handle unreadable/partial files safely and retain origin. The MVP reads only Codex artifact metadata.

## Use cases and acceptance

As a developer, I can refresh after restart without collector failure. Acceptance: SQLite is created locally and inaccessible files do not crash collection.

## Dependencies

SQLite migrations and adapter parsers.
