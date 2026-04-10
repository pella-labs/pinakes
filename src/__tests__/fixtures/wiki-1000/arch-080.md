# Materialized View Pattern

## Concept

Precompute and store query results. Instead of joining multiple tables at query time, maintain a **materialized view** that's updated when the source data changes.

## Implementation

### Database-Level
PostgreSQL `CREATE MATERIALIZED VIEW` — refreshed on demand or schedule.

### Application-Level
Build the view in application code, store in a read-optimized table or cache.

### Event-Driven
Subscribe to domain events and update the view incrementally.

## Example

```sql
-- Source tables
-- orders(id, customer_id, status, created_at)
-- order_items(id, order_id, product_id, quantity, price)

-- Materialized view
CREATE MATERIALIZED VIEW customer_order_summary AS
SELECT
  o.customer_id,
  COUNT(DISTINCT o.id) AS order_count,
  SUM(oi.quantity * oi.price) AS total_spent,
  MAX(o.created_at) AS last_order_at
FROM orders o
JOIN order_items oi ON oi.order_id = o.id
WHERE o.status = 'completed'
GROUP BY o.customer_id;
```

## Trade-offs

- Faster reads at the cost of storage and write overhead
- Staleness (how fresh does the view need to be?)
- Complexity of keeping the view in sync

See [[arch-004]], [[perf-caching]], [[database-sharding]].
