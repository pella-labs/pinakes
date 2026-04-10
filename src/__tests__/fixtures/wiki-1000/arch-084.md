# Read Replica Pattern

## How It Works

Write to a primary database. Replicate to one or more read replicas. Route read queries to replicas.

```
Writes → [Primary DB]
              |
         Replication
         /         \
  [Replica 1]  [Replica 2]
       ↑              ↑
   Read queries    Read queries
```

## Routing

```typescript
class DatabaseRouter {
  constructor(
    private primary: Database,
    private replicas: Database[],
  ) {}

  getWriter(): Database {
    return this.primary;
  }

  getReader(): Database {
    return this.replicas[Math.floor(Math.random() * this.replicas.length)];
  }
}
```

## Replication Lag

Replicas are eventually consistent. After a write, the replica may return stale data. Mitigation:
- Read from primary for critical reads after writes
- Use session-based routing (same user reads from primary for N seconds after a write)
- Monitor replication lag as a key metric

See [[arch-065]], [[arch-040]], [[database-sharding]].
