# Observability for Databases

## Key Database Metrics

Track these regardless of database engine:

- **Query rate**: queries per second by type (SELECT, INSERT, UPDATE, DELETE)
- **Query duration**: p50, p90, p99 by query pattern
- **Connection count**: active, idle, waiting
- **Lock contention**: lock wait time, deadlock count
- **Replication lag**: for replica-based architectures
- **Cache hit ratio**: buffer pool / shared buffers effectiveness

## PostgreSQL Specific

```sql
-- Cache hit ratio (should be >99%)
SELECT 
  sum(heap_blks_hit) / nullif(sum(heap_blks_hit) + sum(heap_blks_read), 0) AS cache_hit_ratio
FROM pg_statio_user_tables;

-- Index usage (should be >95%)
SELECT 
  relname,
  idx_scan / nullif(seq_scan + idx_scan, 0) AS index_usage_ratio
FROM pg_stat_user_tables
WHERE seq_scan + idx_scan > 0
ORDER BY index_usage_ratio;

-- Table bloat estimation
SELECT schemaname, relname, n_dead_tup, n_live_tup,
  round(n_dead_tup::numeric / nullif(n_live_tup, 0) * 100, 2) AS dead_pct
FROM pg_stat_user_tables
ORDER BY n_dead_tup DESC;
```

## Alerting Thresholds

- Cache hit ratio < 99%: investigate missing indexes or undersized shared_buffers
- Replication lag > 10s: investigate replica capacity
- Connection count > 80% of max: add pooling or investigate leaks
- Dead tuple ratio > 20%: autovacuum may be falling behind

See [[perf-014]] for Prometheus and [[perf-077]] for database maintenance.
