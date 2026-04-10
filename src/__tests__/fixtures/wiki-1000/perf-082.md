---
title: Query Caching Strategies
tags: [caching, database, performance]
---
# Query Caching Strategies

## Application-Level Query Cache

Cache query results in Redis or in-process memory, keyed by the normalized query and parameters.

```typescript
async function cachedQuery<T>(sql: string, params: any[], ttlSec: number): Promise<T[]> {
  const cacheKey = `qcache:${hash(sql + JSON.stringify(params))}`;
  const cached = await redis.get(cacheKey);
  if (cached) return JSON.parse(cached);

  const result = await db.query(sql, params);
  await redis.setex(cacheKey, ttlSec, JSON.stringify(result));
  return result;
}
```

## Invalidation by Table

Track which tables a cached query depends on. When a write occurs on a table, invalidate all cached queries that read from it.

## Invalidation by Entity

More granular: track which entity IDs a cached query reads. When an entity is updated, invalidate only caches that included that entity.

## Query Result Fingerprinting

Instead of TTL-based invalidation, compute a fingerprint of the result set. On cache hit, re-run a lightweight version of the query (e.g., `SELECT MAX(updated_at)`) to check if the fingerprint has changed.

## When to Skip Query Caching

- Queries that always return unique results (user-specific data with no sharing)
- Write-heavy tables where invalidation frequency exceeds query frequency
- Queries with highly variable parameters (low cache hit rate)

See [[perf-001]] for cache invalidation and [[perf-002]] for Redis patterns.
