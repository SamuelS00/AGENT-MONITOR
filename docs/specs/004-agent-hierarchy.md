# SPEC 004: Agent hierarchy

## Objective and scope
Render recursively nested execution nodes and their provenance; excludes claiming delegation from a process relationship alone.

## Requirements and rules
Prevent cycles/duplicates, mark inferred edges, and never double-count child tokens.

## Use cases and acceptance
As a developer, I can expand a confirmed hierarchy and inspect its confidence. Acceptance: the explorer expands/collapses nodes and labels relationship reliability.

## Dependencies
Normalized execution graph and future adapter evidence.
