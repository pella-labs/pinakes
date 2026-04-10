---
source: extracted
---
# Rate Limiting Strategies

## Token Bucket

The most common algorithm. A bucket holds tokens; each request consumes one. Tokens refill at a fixed rate. Allows bursts up to bucket capacity.

## Sliding Window

Track request counts in a sliding time window. More accurate than fixed windows but requires more memory.

## Leaky Bucket

Requests enter a queue (bucket) and are processed at a fixed rate. Smooths out bursts but adds latency.

## Implementation Levels

- **Application level** — middleware in your service
- **API gateway** — Kong, Traefik rate limiting plugins
- **Infrastructure** — Envoy, Nginx rate limiting
- **Client-side** — respect `Retry-After` headers

## Redis-Based Rate Limiter

```lua
-- Redis Lua script for sliding window rate limiting
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local now = tonumber(ARGV[3])

redis.call('ZREMRANGEBYSCORE', key, 0, now - window)
local count = redis.call('ZCARD', key)

if count < limit then
  redis.call('ZADD', key, now, now .. math.random())
  redis.call('EXPIRE', key, window)
  return 1
end
return 0
```

See [[arch-012]], [[arch-014]].
