# Database Read Replicas

## Scaling Reads

A single database server handles both reads and writes. When reads dominate (common in most applications), offloading reads to **replicas** scales horizontally.

## Replication Lag

Replicas are asynchronously updated. The lag between primary and replica can range from milliseconds to seconds. Design around this:

- After a write, read from the primary for the writing user
- Other users can read from replicas (eventual consistency is fine)
- Critical reads (payment verification) always hit the primary

## Routing Logic

```typescript
class DatabaseRouter {
  constructor(
    private primary: Pool,
    private replicas: Pool[],
  ) {}

  getReadPool(requireConsistency: boolean = false): Pool {
    if (requireConsistency) return this.primary;
    return this.replicas[Math.floor(Math.random() * this.replicas.length)];
  }

  getWritePool(): Pool {
    return this.primary;
  }
}
```

## Monitoring Replication

Track replication lag per replica. Alert when lag exceeds your consistency tolerance. In PostgreSQL:

```sql
SELECT client_addr, state, sent_lsn, write_lsn, flush_lsn, replay_lsn,
  (sent_lsn - replay_lsn) AS replication_lag
FROM pg_stat_replication;
```

See [[perf-007]] for query optimization and [[perf-009]] for connection pooling.
