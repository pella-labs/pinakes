# Slow Query Logging and Analysis

## Enabling Slow Query Logging

### PostgreSQL

```sql
ALTER SYSTEM SET log_min_duration_statement = 100; -- log queries >100ms
ALTER SYSTEM SET log_statement = 'none'; -- don't log all queries
SELECT pg_reload_conf();
```

### MySQL

```sql
SET GLOBAL slow_query_log = 'ON';
SET GLOBAL long_query_time = 0.1;
SET GLOBAL log_queries_not_using_indexes = 'ON';
```

## Analysis Tools

- **pg_stat_statements**: PostgreSQL extension that tracks execution statistics per query pattern
- **pt-query-digest**: Percona tool that aggregates slow query logs into ranked reports
- **pgBadger**: PostgreSQL log analyzer with visual reports

## Prioritization

Rank slow queries by **total time** (frequency × average duration), not by single-execution duration. A 50ms query that runs 100,000 times per day (5000s total) is a bigger problem than a 5s query that runs twice per day (10s total).

## Common Fixes

- Add or adjust indexes
- Rewrite subqueries as JOINs
- Materialize expensive CTEs
- Paginate instead of fetching all rows
- Cache results of frequently repeated identical queries

See [[perf-007]] for query optimization and [[perf-037]] for index design.
