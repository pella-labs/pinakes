# Database Connection Management in Node.js

## The Event Loop Trap

Node.js is single-threaded. If a database query takes 200ms and you're doing synchronous waits, you block the entire event loop. Always use async database drivers.

## Pool Configuration for Node.js

```typescript
import { Pool } from 'pg';

const pool = new Pool({
  host: process.env.DB_HOST,
  port: 5432,
  database: process.env.DB_NAME,
  max: 10,                    // don't go higher without benchmarking
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  allowExitOnIdle: true,
});

// Always handle pool errors
pool.on('error', (err) => {
  logger.error({ err }, 'unexpected pool error');
});
```

## Query Patterns

### Checked-out connections
For transactions that span multiple queries:

```typescript
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query('INSERT INTO orders ...', [values]);
  await client.query('UPDATE inventory ...', [values]);
  await client.query('COMMIT');
} catch (err) {
  await client.query('ROLLBACK');
  throw err;
} finally {
  client.release(); // CRITICAL: always release back to pool
}
```

### Pool.query shorthand
For single queries, use `pool.query()` directly — it automatically checks out and releases.

## Monitoring Pool Health

Export pool metrics to Prometheus:
- `db_pool_total`: total connections
- `db_pool_idle`: idle connections
- `db_pool_waiting`: clients waiting for a connection

If `waiting` is consistently > 0, increase pool size or optimize query duration.

See [[perf-009]] for pooling theory and [[perf-028]] for advanced patterns.
