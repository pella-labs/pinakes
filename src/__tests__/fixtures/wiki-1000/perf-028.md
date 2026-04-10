# Advanced Connection Pooling Patterns

## Pool-per-Tenant

In multi-tenant applications, isolate database connections per tenant to prevent noisy neighbors. A misbehaving tenant's slow queries won't exhaust the pool for others.

```typescript
class TenantPoolManager {
  private pools: Map<string, Pool> = new Map();

  getPool(tenantId: string): Pool {
    if (!this.pools.has(tenantId)) {
      this.pools.set(tenantId, createPool({
        max: 5,
        connectionString: this.getConnectionString(tenantId),
      }));
    }
    return this.pools.get(tenantId)!;
  }
}
```

## Connection Warming

Pre-establish connections before they are needed. On application startup, open `min` connections immediately rather than creating them on first request.

## Health Checks

Periodically validate idle connections with a lightweight query (`SELECT 1`). Remove stale connections that have been severed by network interruptions or database restarts.

## Statement-Level Timeouts

Set query-level timeouts independent of connection timeouts:

```sql
SET statement_timeout = '5s';
```

This prevents a single slow query from holding a connection indefinitely.

## Connection Tagging

Tag connections with metadata (tenant ID, request ID) for debugging. When a connection is leaked, the tag tells you which code path is responsible.

See [[perf-009]] for basic pooling and [[perf-007]] for query optimization.
