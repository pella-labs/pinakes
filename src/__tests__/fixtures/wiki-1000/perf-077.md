# Database Vacuum and Maintenance

## Why VACUUM Matters

PostgreSQL uses MVCC (Multi-Version Concurrency Control). Deleted or updated rows aren't immediately removed — they become **dead tuples**. VACUUM reclaims this space.

## Autovacuum Tuning

```sql
-- Check autovacuum activity
SELECT schemaname, relname, n_dead_tup, last_autovacuum
FROM pg_stat_user_tables
ORDER BY n_dead_tup DESC;
```

For high-write tables, increase autovacuum frequency:

```sql
ALTER TABLE orders SET (
  autovacuum_vacuum_threshold = 100,
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_analyze_threshold = 50,
  autovacuum_analyze_scale_factor = 0.02
);
```

## VACUUM vs VACUUM FULL

- **VACUUM**: marks dead tuples as reusable, doesn't shrink the table file. Non-blocking.
- **VACUUM FULL**: rewrites the entire table, reclaiming disk space. Requires exclusive lock — blocks reads and writes.

Prefer regular VACUUM. Only use VACUUM FULL when table bloat is extreme.

## Index Bloat

Indexes also accumulate bloat from dead tuples. Use `REINDEX` periodically, or `pg_repack` for online reindexing without locks.

## Transaction ID Wraparound

PostgreSQL's transaction IDs are 32-bit integers. Autovacuum freezes old transaction IDs to prevent wraparound. If autovacuum falls behind, the database will shut down to prevent data corruption. Monitor `age(datfrozenxid)`.

See [[perf-037]] for index design and [[perf-007]] for query optimization.
