# Memcached vs Redis: When to Use Which

## Core Differences

**Memcached** is a simple, multi-threaded key-value cache. **Redis** is a data structure server with persistence, pub/sub, and scripting. The choice depends on your use case.

## Choose Memcached When

- You need a pure, ephemeral cache with no persistence
- Your access pattern is simple GET/SET with string values
- You want to leverage multi-threaded architecture for high throughput on multi-core machines
- Memory efficiency is paramount (Memcached has lower per-key overhead)

## Choose Redis When

- You need data structures beyond strings (lists, sets, sorted sets, hashes)
- Persistence matters (RDB snapshots, AOF)
- You want pub/sub, Lua scripting, or transactions
- You need TTL with key-level granularity and eviction policies
- Your application benefits from atomic operations on complex data

## Performance Comparison

For simple GET/SET operations on small values, both achieve similar throughput (~100K ops/sec per core). Redis is single-threaded for command processing (io-threads for I/O in 6.0+), while Memcached scales linearly across cores.

The real difference emerges with complex operations. Redis's sorted sets with `ZRANGEBYSCORE` replace what would be multiple Memcached GETs plus application-side sorting.

See [[perf-002]] for Redis patterns and [[perf-028]] for connection pooling.
