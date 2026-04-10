# ACID vs BASE

## ACID

Traditional database guarantees:
- **Atomicity** — all or nothing
- **Consistency** — valid state after every transaction
- **Isolation** — concurrent transactions don't interfere
- **Durability** — committed data survives crashes

## BASE

Distributed systems trade-off:
- **Basically Available** — the system mostly works
- **Soft state** — state may change over time (even without input)
- **Eventually consistent** — reads converge to the latest write

## When to Use Each

| Use Case | Model |
|---|---|
| Financial transactions | ACID |
| User profile updates | ACID or BASE |
| Social media feeds | BASE |
| Inventory counts | ACID for reservations, BASE for display |
| Search indexes | BASE |
| Session data | BASE |

## Hybrid Approach

Most real systems use both. Core business transactions use ACID (PostgreSQL). Analytics, caching, and derived data use BASE (Elasticsearch, Redis).

See [[arch-066]], [[arch-040]].
