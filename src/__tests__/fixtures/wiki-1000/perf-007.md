# Database Query Optimization Fundamentals

## The Cost of Bad Queries

A single unoptimized query can bring down an entire application. **Query optimization** is about understanding how the database engine executes your SQL and giving it the information it needs to choose efficient plans.

## EXPLAIN ANALYZE

Always start with `EXPLAIN ANALYZE`. It shows the actual execution plan, not the estimated one.

```sql
EXPLAIN ANALYZE
SELECT u.name, COUNT(o.id) as order_count
FROM users u
LEFT JOIN orders o ON o.user_id = u.id
WHERE u.created_at > '2025-01-01'
GROUP BY u.id, u.name
ORDER BY order_count DESC
LIMIT 20;
```

Look for:
- **Seq Scan** on large tables (missing index)
- **Nested Loop** with high row counts (consider hash join)
- **Sort** operations spilling to disk (increase work_mem)
- Large discrepancy between estimated and actual rows (stale statistics)

## Index Strategy

Create indexes to support your query patterns, not your table structure. A covering index that includes all columns in the SELECT avoids the heap lookup entirely.

- **B-tree**: default, good for equality and range queries
- **Hash**: equality only, faster for point lookups
- **GIN**: full-text search, JSONB containment
- **GiST**: geometric, range types

## Statistics and the Query Planner

Run `ANALYZE` after bulk data changes. The planner relies on table statistics to estimate cardinality and choose join strategies. Stale statistics lead to catastrophically bad plans.

See [[perf-008]] for N+1 query patterns.
