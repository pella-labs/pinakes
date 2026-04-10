# Database Lock Contention

## Types of Locks

### Row-Level Locks
Acquired automatically during UPDATE and DELETE. Least contention since different rows can be modified concurrently.

### Table-Level Locks
Schema modifications (ALTER TABLE, CREATE INDEX) acquire table-level locks that block all other operations on the table.

### Advisory Locks
Application-defined locks implemented in the database. Useful for coordinating distributed processes.

## Detecting Contention

```sql
-- Active locks in PostgreSQL
SELECT pid, locktype, relation::regclass, mode, granted, waitstart
FROM pg_locks
WHERE NOT granted
ORDER BY waitstart;

-- Blocked queries
SELECT blocked.pid AS blocked_pid,
       blocked.query AS blocked_query,
       blocking.pid AS blocking_pid,
       blocking.query AS blocking_query
FROM pg_stat_activity blocked
JOIN pg_locks bl ON bl.pid = blocked.pid AND NOT bl.granted
JOIN pg_locks gl ON gl.pid != blocked.pid AND gl.locktype = bl.locktype
  AND gl.relation = bl.relation AND gl.granted
JOIN pg_stat_activity blocking ON blocking.pid = gl.pid;
```

## Reducing Contention

- Keep transactions short. Don't hold locks while doing I/O.
- Access rows in consistent order to prevent deadlocks.
- Use `CREATE INDEX CONCURRENTLY` instead of `CREATE INDEX`.
- Use `SKIP LOCKED` for job queues to avoid blocking.
- Batch updates in smaller transactions.

## Lock Timeouts

```sql
SET lock_timeout = '5s';  -- fail rather than wait forever
```

See [[perf-007]] for query optimization and [[perf-077]] for maintenance.
