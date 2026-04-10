# Distributed Rate Limiting

## The Problem

When running multiple application instances behind a load balancer, local rate limiting allows `N * limit` total requests across N instances. For true rate limiting, you need shared state.

## Redis-Based Implementation

```typescript
import { Redis } from 'ioredis';

async function slidingWindowRateLimit(
  redis: Redis,
  key: string,
  limit: number,
  windowMs: number,
): Promise<{ allowed: boolean; remaining: number }> {
  const now = Date.now();
  const windowStart = now - windowMs;

  const pipe = redis.pipeline();
  pipe.zremrangebyscore(key, 0, windowStart);  // remove old entries
  pipe.zadd(key, now.toString(), `${now}:${Math.random()}`);  // add current
  pipe.zcard(key);  // count entries in window
  pipe.pexpire(key, windowMs);  // set TTL

  const results = await pipe.exec();
  const count = results![2][1] as number;

  return {
    allowed: count <= limit,
    remaining: Math.max(0, limit - count),
  };
}
```

## Token Bucket with Redis

```typescript
async function tokenBucket(
  redis: Redis,
  key: string,
  rate: number,      // tokens per second
  capacity: number,  // max burst
): Promise<boolean> {
  const script = `
    local tokens = tonumber(redis.call('get', KEYS[1]) or ARGV[2])
    local last = tonumber(redis.call('get', KEYS[2]) or ARGV[3])
    local now = tonumber(ARGV[3])
    local elapsed = now - last
    tokens = math.min(tonumber(ARGV[2]), tokens + elapsed * tonumber(ARGV[1]))
    if tokens < 1 then return 0 end
    tokens = tokens - 1
    redis.call('set', KEYS[1], tokens)
    redis.call('set', KEYS[2], now)
    return 1
  `;
  const result = await redis.eval(script, 2, `${key}:tokens`, `${key}:ts`, rate, capacity, Date.now() / 1000);
  return result === 1;
}
```

## Edge Rate Limiting

For lowest latency, implement rate limiting at the CDN edge using workers or edge functions. This stops abusive traffic before it reaches your origin.

See [[perf-030]] for rate limiting patterns and [[perf-002]] for Redis.
