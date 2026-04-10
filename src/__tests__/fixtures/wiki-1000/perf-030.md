---
title: Rate Limiting Patterns
tags: [rate-limiting, api, performance]
---
# Rate Limiting Patterns

## Why Rate Limit

**Rate limiting** protects services from abuse, ensures fair resource allocation, and prevents cascading failures from traffic spikes.

## Algorithms

### Token Bucket
A bucket holds N tokens. Each request consumes one token. Tokens are added at a fixed rate. Requests are rejected when the bucket is empty. Allows bursts up to bucket capacity.

### Sliding Window Log
Track timestamps of all requests in a window. Count entries to determine if the limit is exceeded. Precise but memory-intensive.

### Sliding Window Counter
Combine the current window count with a weighted count from the previous window. Good approximation with minimal memory.

## Implementation with Redis

```typescript
async function checkRateLimit(key: string, limit: number, windowSec: number): Promise<boolean> {
  const current = await redis.incr(key);
  if (current === 1) {
    await redis.expire(key, windowSec);
  }
  return current <= limit;
}
```

## Response Headers

Always communicate rate limit status to clients:

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 42
X-RateLimit-Reset: 1704067200
Retry-After: 30
```

## Distributed Rate Limiting

When running multiple application instances, centralize rate limit state in Redis or use a gossip protocol to share counters. Local-only rate limiting allows `N * limit` total requests across N instances.

See [[perf-002]] for Redis patterns.
