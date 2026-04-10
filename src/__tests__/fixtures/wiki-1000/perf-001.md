# Cache Invalidation Strategies

## Overview

Cache invalidation remains one of the hardest problems in computer science. Getting it wrong means serving stale data; getting it right requires careful thought about **consistency guarantees** and **latency budgets**.

## Time-Based Expiry (TTL)

The simplest approach is setting a **time-to-live** on every cached entry. When the TTL expires, the next request triggers a fresh fetch from the origin.

- Works well for data that changes infrequently
- Simple to implement and reason about
- Risk of serving stale data up to TTL duration
- Cannot handle urgent invalidation without a side channel

## Event-Driven Invalidation

A more sophisticated approach uses **domain events** to trigger cache purges. When the underlying data changes, the write path publishes an event, and the cache layer subscribes to it.

```typescript
interface CacheInvalidationEvent {
  key: string;
  reason: 'update' | 'delete' | 'expire';
  timestamp: number;
  source: string;
}

class EventDrivenCache<T> {
  private store: Map<string, { value: T; version: number }> = new Map();

  invalidate(event: CacheInvalidationEvent): void {
    this.store.delete(event.key);
    this.metrics.increment('cache.invalidation', { reason: event.reason });
  }
}
```

## Write-Through vs Write-Behind

**Write-through** updates the cache synchronously with the backing store. This guarantees consistency but adds latency to the write path. **Write-behind** (or write-back) queues the backing store update asynchronously, accepting a window of inconsistency for lower write latency.

See also [[perf-003]] for Redis-specific invalidation patterns and [[perf-010]] for CDN cache busting.

## Cache Stampede Prevention

When a heavily-used cache key expires, dozens or hundreds of requests simultaneously attempt to regenerate it. This **cache stampede** can overwhelm the backend and trigger cascading failures across dependent services.

### Probabilistic Early Expiration

Instead of a hard TTL, add random jitter. Each access checks: should I refresh early? The probability of refreshing increases as the key approaches expiration:

```typescript
function shouldRefreshEarly(ttlRemaining: number, totalTtl: number): boolean {
  const beta = 1.0; // tuning parameter
  const delta = totalTtl * beta;
  return Math.random() < Math.exp(-ttlRemaining / delta);
}
```

### Request Coalescing

When multiple identical requests arrive concurrently, only execute one and share the result with all waiters. This is sometimes called **single-flight** or **request deduplication**.

The pattern applies broadly: cache misses, API calls, database queries — anywhere many requests for the same data arrive simultaneously. Libraries like `singleflight` (Go) or custom implementations with a Promise map handle this elegantly.

### Cache Warming on Deploy

After deploying new code, caches are cold. Pre-warm critical cache keys during the deployment process to avoid a stampede when traffic shifts to the new instances. This is particularly important for configuration data, feature flags, and high-traffic entity lookups.
