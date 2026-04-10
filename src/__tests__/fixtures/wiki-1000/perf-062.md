# Redis Memory Optimization

## Data Structure Choice Matters

Redis stores data in memory, making every byte count. Choose the right data structure:

- **Strings**: simple but each key has ~50 bytes overhead
- **Hashes**: for objects with multiple fields; uses ziplist encoding for small hashes (huge memory savings)
- **Sorted Sets**: ziplist for small sets, skiplist for large

## Ziplist Optimization

Redis uses compact **ziplist** encoding for small hashes, lists, and sorted sets. Tune thresholds:

```
hash-max-ziplist-entries 128
hash-max-ziplist-value 64
list-max-ziplist-size -2
zset-max-ziplist-entries 128
zset-max-ziplist-value 64
```

## Key Expiration Strategies

- **Lazy expiration**: check TTL on access, delete if expired
- **Active expiration**: Redis periodically samples keys and deletes expired ones
- Both run concurrently; active expiration prevents memory from filling with expired-but-unaccessed keys

## Memory Analysis

```bash
# Overall memory breakdown
redis-cli INFO memory

# Analyze key space
redis-cli --bigkeys

# Sample-based memory analysis
redis-cli MEMORY USAGE <key>
```

## Eviction Policies

When maxmemory is reached:
- `allkeys-lru`: evict least recently used (best for cache)
- `volatile-lru`: evict LRU among keys with TTL
- `allkeys-lfu`: evict least frequently used (Redis 4.0+)
- `noeviction`: return errors (best for data stores)

See [[perf-002]] for Redis caching patterns and [[perf-003]] for cluster topology.
