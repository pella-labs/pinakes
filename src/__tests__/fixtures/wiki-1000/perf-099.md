# PostgreSQL Performance Tuning

## Memory Configuration

```sql
-- Shared buffers: 25% of system RAM
shared_buffers = '4GB'

-- Working memory per operation (sorts, hashes)
work_mem = '256MB'

-- Maintenance operations (VACUUM, CREATE INDEX)
maintenance_work_mem = '1GB'

-- WAL buffers
wal_buffers = '64MB'

-- Effective cache size (hint to planner, not actual allocation)
effective_cache_size = '12GB'
```

## Connection Configuration

```sql
-- Max connections
max_connections = 200

-- Reserve connections for superuser
superuser_reserved_connections = 3

-- Use PgBouncer for connection pooling rather than increasing max_connections
```

## Write Performance

```sql
-- Checkpoint configuration
checkpoint_timeout = '10min'
max_wal_size = '4GB'
checkpoint_completion_target = 0.9

-- Synchronous commit (trade durability for speed)
synchronous_commit = 'off'  -- safe for data that can be reconstructed
```

## Query Planner

```sql
-- Parallelism
max_parallel_workers_per_gather = 4
max_parallel_workers = 8
parallel_tuple_cost = 0.01

-- Statistics
default_statistics_target = 200  -- increase for skewed data
```

## Monitoring Queries

```sql
-- Long-running queries
SELECT pid, now() - pg_stat_activity.query_start AS duration, query
FROM pg_stat_activity
WHERE state != 'idle'
ORDER BY duration DESC;
```

See [[perf-007]] for query optimization and [[perf-077]] for maintenance.
