# Thundering Herd Problem

## What Happens

When a popular cache key expires, many concurrent requests simultaneously miss the cache and hit the backend. The backend is overwhelmed, responses are slow, and the cache stampede cascades.

## Solutions

### Locking
Only one request fetches from the backend; others wait for the cache to be repopulated.

```typescript
async function getWithLock<T>(key: string, fetcher: () => Promise<T>, ttl: number): Promise<T> {
  const cached = await redis.get(key);
  if (cached) return JSON.parse(cached);

  const lockKey = `lock:${key}`;
  const acquired = await redis.set(lockKey, '1', 'EX', 10, 'NX');
  
  if (!acquired) {
    // Wait and retry
    await new Promise(resolve => setTimeout(resolve, 100));
    return getWithLock(key, fetcher, ttl);
  }

  try {
    const value = await fetcher();
    await redis.setex(key, ttl, JSON.stringify(value));
    return value;
  } finally {
    await redis.del(lockKey);
  }
}
```

### Early Expiration
Refresh the cache before the TTL expires. Add a "soft TTL" that's earlier than the actual TTL, and probabilistically refresh.

### Stale-While-Revalidate
Serve stale data immediately while refreshing in the background. The first request that sees stale data triggers the refresh.

## Prevention

- Stagger TTLs with random jitter to avoid synchronized expiration
- Use background refresh for high-traffic keys
- Limit concurrent backend requests with a semaphore

See [[perf-001]] for cache invalidation and [[perf-033]] for retry strategies.
