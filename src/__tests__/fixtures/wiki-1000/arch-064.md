---
source: extracted
---
# Architecture Decision Records

## Format

An **ADR** documents a significant architectural decision. Use Michael Nygard's template:

```markdown
# ADR-001: Use PostgreSQL for primary storage

## Status
Accepted

## Context
We need a primary database for our order management system.
We process ~10K orders/day with complex queries and need ACID guarantees.

## Decision
Use PostgreSQL 16 as our primary database.

## Consequences
- Positive: Strong ACID guarantees, excellent query planner, JSON support
- Positive: Team has deep PostgreSQL experience
- Negative: Single-node write throughput ceiling (~50K TPS)
- Negative: Operational overhead vs. managed DynamoDB
```

## Storage

Store ADRs in `docs/adr/` or `dev-docs/adr/`. Number sequentially.

## Lifecycle

- **Proposed** → **Accepted** → optionally **Superseded** by a later ADR
- Never delete ADRs — they're a historical record
- When superseding, link from old to new

## Tools

- **adr-tools** — CLI for managing ADRs
- **Log4brains** — ADR management with a web UI

See [[arch-006]].
