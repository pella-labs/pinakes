---
title: Redis Caching Patterns
tags: [redis, caching, performance]
created: 2025-11-15
---
# Redis Caching Patterns

## Cache-Aside (Lazy Loading)

The **cache-aside** pattern is the most common Redis caching strategy. The application checks Redis first; on a miss, it queries the database, stores the result in Redis, then returns it.

```typescript
async function getUserProfile(userId: string): Promise<UserProfile> {
  const cached = await redis.get(`user:${userId}`);
  if (cached) return JSON.parse(cached);

  const profile = await db.users.findById(userId);
  await redis.setex(`user:${userId}`, 3600, JSON.stringify(profile));
  return profile;
}
```

## Read-Through Cache

In a **read-through** configuration, the cache itself is responsible for loading data on a miss. The application only ever talks to the cache layer.

## Write-Through with Redis

Combining write-through with Redis ensures the cache is always warm after writes:

- Application writes to Redis and the database in a single transaction
- Eliminates the cold-cache problem after updates
- Higher write latency due to dual writes

## Key Design Considerations

- Use **hash tags** for related keys that must live on the same shard
- Set **maxmemory-policy** to `allkeys-lru` for pure caches
- Avoid storing large blobs; prefer structured hashes over serialized JSON
- Monitor **eviction rate** — if it spikes, your working set exceeds memory

See [[perf-001]] for general invalidation strategies.
