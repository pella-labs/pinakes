# In-Process Caching

## When to Use

**In-process caching** stores data in the application's memory space. No network round trip, no serialization. Fastest possible cache access.

Best for:
- Configuration data loaded at startup
- Small, frequently accessed reference data
- Computed values that are expensive to derive

## LRU Cache Implementation

```typescript
class LRUCache<K, V> {
  private cache: Map<K, V> = new Map();

  constructor(private maxSize: number) {}

  get(key: K): V | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      // Move to end (most recently used)
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }

  set(key: K, value: V): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // Delete oldest (first) entry
      const oldest = this.cache.keys().next().value;
      this.cache.delete(oldest);
    }
    this.cache.set(key, value);
  }
}
```

## Limitations

- **Per-instance**: each process has its own cache. Updates to one don't propagate to others.
- **Memory pressure**: large caches compete with the application for heap space.
- **Cold starts**: cache is empty after restart or deployment.
- **No TTL by default**: must implement expiration logic.

## When to Prefer Distributed Cache

If you need cache consistency across instances, shared state, or cache survival across deploys, use Redis or Memcached instead.

See [[perf-002]] for Redis patterns and [[perf-068]] for the caching hierarchy.
