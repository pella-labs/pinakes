# Database Index Design

## Index Types in PostgreSQL

### B-Tree (Default)
Works for equality (`=`), range (`<`, `>`, `BETWEEN`), and sort (`ORDER BY`). The workhorse index.

### Hash
Equality only. Slightly faster than B-tree for point lookups but cannot support range queries. Crash-safe since PostgreSQL 10.

### GIN (Generalized Inverted Index)
For multi-valued columns: arrays, JSONB, full-text search (tsvector). Slower to update, faster to query.

### BRIN (Block Range Index)
For naturally ordered data (timestamps, auto-incrementing IDs). Extremely small index that stores min/max per block range.

## Partial Indexes

Index only the rows you query:

```sql
CREATE INDEX idx_orders_pending ON orders(created_at) 
WHERE status = 'pending';
```

This index is tiny compared to a full index on `created_at` and is perfect if you only query pending orders.

## Composite Index Column Order

The leftmost column in a composite index is the most selective filter. Put the most selective column first:

```sql
-- Good: status has few values, created_at narrows further
CREATE INDEX idx_orders_status_date ON orders(status, created_at);

-- Bad: created_at first means the index is useless for status-only queries
CREATE INDEX idx_orders_date_status ON orders(created_at, status);
```

## Index Maintenance

- Monitor `pg_stat_user_indexes` for unused indexes
- Reindex bloated indexes periodically
- Drop indexes before bulk loads, recreate after

See [[perf-007]] for query optimization.
