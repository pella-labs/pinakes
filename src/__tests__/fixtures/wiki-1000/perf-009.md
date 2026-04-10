# Connection Pooling

## Why Pools Matter

Database connections are expensive to create. Each involves TCP handshake, TLS negotiation, authentication, and session setup. A **connection pool** maintains a set of idle connections ready for reuse.

## Pool Sizing

The optimal pool size is often smaller than people think. The formula from the PostgreSQL wiki:

```
pool_size = ((core_count * 2) + effective_spindle_count)
```

For a 4-core machine with SSD: `(4 * 2) + 1 = 9` connections. More connections means more context switching, lock contention, and memory overhead.

## Configuration

Key pool parameters:

- **min**: minimum idle connections (keep warm)
- **max**: maximum total connections (hard ceiling)
- **idleTimeoutMillis**: close connections idle longer than this
- **connectionTimeoutMillis**: how long to wait for a free connection
- **maxUses**: retire connections after N uses (prevents memory leaks)

## Common Mistakes

- Setting pool max too high overwhelms the database
- Not configuring idle timeout leads to stale connections
- Using multiple pools per application instance (ORMs sometimes create hidden pools)
- Forgetting to release connections back to the pool in error paths

## PgBouncer

For PostgreSQL, **PgBouncer** acts as a lightweight connection multiplexer between application pools and the database. It supports transaction-mode pooling where connections are shared between transactions rather than sessions.

See [[perf-007]] for query optimization and [[perf-028]] for advanced pooling patterns.
