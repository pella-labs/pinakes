---
title: Database Connection Lifecycle
tags: [database, connections, performance]
---
# Database Connection Lifecycle

## Phases of a Connection

1. **DNS resolution**: resolve the database hostname
2. **TCP handshake**: three-way handshake
3. **TLS negotiation**: if SSL is enabled (1-2 RTTs)
4. **Authentication**: username/password or certificate verification
5. **Session setup**: set session parameters, load extensions
6. **Query execution**: the actual work
7. **Teardown**: graceful close or timeout

For a remote database with 10ms RTT and TLS, connection setup takes 40-60ms. This is why connection pooling matters.

## Connection States

- **Active**: executing a query
- **Idle**: connected but not executing
- **Idle in transaction**: inside a BEGIN block but not executing

**Idle in transaction** connections are dangerous: they hold locks and prevent VACUUM from cleaning dead tuples.

## Detecting Leaked Connections

```sql
-- Find idle-in-transaction connections older than 5 minutes
SELECT pid, usename, state, query, now() - state_change AS duration
FROM pg_stat_activity
WHERE state = 'idle in transaction'
  AND now() - state_change > interval '5 minutes';
```

## Automatic Cleanup

Set `idle_in_transaction_session_timeout` to automatically kill long-idle transactions:

```sql
ALTER SYSTEM SET idle_in_transaction_session_timeout = '30s';
```

See [[perf-009]] for connection pooling and [[perf-040]] for Node.js specifics.
