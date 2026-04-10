# Database Per Service Pattern

In a microservices architecture, each service owns its database. No service directly accesses another service's data store. This is the **database per service** pattern.

## Motivation

Shared databases create hidden coupling. When service A reads from service B's tables, schema changes in B can break A. Worse, when multiple services write to the same tables, you get locking contention and unclear ownership of data invariants.

## Implementation Options

| Storage Type | Good For | Example |
|---|---|---|
| PostgreSQL | Rich queries, transactions | Order service, billing |
| MongoDB | Flexible schemas, documents | Product catalog |
| Redis | Caching, sessions | Auth service, rate limiting |
| Elasticsearch | Full-text search | Search service |
| TimescaleDB | Time-series data | Metrics, audit logs |

See [[database-patterns]] for specific schema design patterns within each service.

## Cross-Service Queries

The challenge: how do you query data that spans services? Options:

- **API composition**: the calling service queries multiple services and joins the results in memory. Simple but slow for large datasets.
- **CQRS read models**: maintain denormalized views built from events ([[arch-005]]). Fast queries but eventual consistency.
- **Data lake/warehouse**: for analytics queries that span the entire domain. Not suitable for real-time use.

## Data Consistency

Without distributed transactions, you accept eventual consistency for cross-service operations. The [[arch-010]] saga pattern manages multi-service transactions through compensating actions rather than distributed locks.

```sql
-- Each service manages its own migrations independently
-- Order service migration
CREATE TABLE orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL,  -- reference, not FK
    status TEXT NOT NULL DEFAULT 'pending',
    total_cents INTEGER NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Note: customer_id is NOT a foreign key. The customer
-- lives in a different service's database. Referential
-- integrity is maintained at the application level.
```
