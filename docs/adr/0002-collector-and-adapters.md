# ADR 0002: Collector and adapters

## Context
CLI vendors expose unequal process/session metadata.

## Alternatives
Parse logs directly in React; one universal parser; capability-scoped adapters.

## Decision
Use Rust discovery plus independent adapters normalizing into the domain model.

## Consequences
Features can be marked unavailable per tool without contaminating the UI or core.
