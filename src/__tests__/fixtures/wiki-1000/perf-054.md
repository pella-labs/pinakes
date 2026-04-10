# Materialized Views

## What They Are

A **materialized view** stores the result of a query as a physical table. Unlike regular views, they don't re-execute the query on every read. This trades storage and freshness for read performance.

## PostgreSQL Materialized Views

```sql
CREATE MATERIALIZED VIEW mv_daily_revenue AS
SELECT 
  date_trunc('day', created_at) AS day,
  product_id,
  SUM(amount) AS total_revenue,
  COUNT(*) AS order_count
FROM orders
WHERE status = 'completed'
GROUP BY 1, 2;

-- Refresh (blocking)
REFRESH MATERIALIZED VIEW mv_daily_revenue;

-- Concurrent refresh (non-blocking, requires unique index)
CREATE UNIQUE INDEX ON mv_daily_revenue (day, product_id);
REFRESH MATERIALIZED VIEW CONCURRENTLY mv_daily_revenue;
```

## Refresh Strategies

- **Scheduled**: refresh via cron at fixed intervals
- **On-demand**: refresh after significant data changes
- **Incremental**: only update changed rows (requires custom logic in PostgreSQL; some databases support natively)

## When to Use

Materialized views are ideal for:

- Dashboard queries that aggregate large datasets
- Reports that tolerate staleness (refreshed hourly/daily)
- Denormalized read models in CQRS architectures
- Expensive JOINs that are queried frequently

## Gotchas

- Storage doubles or more depending on aggregation
- Concurrent refresh requires a unique index
- Stale data between refreshes
- Dependencies on source tables aren't always obvious

See [[perf-007]] for query optimization.
