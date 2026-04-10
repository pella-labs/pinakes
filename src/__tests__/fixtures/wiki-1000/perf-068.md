# Caching at Every Layer

## The Cache Hierarchy

Modern applications have caches at every layer. Understanding where data is cached (and for how long) is essential for debugging staleness issues.

### Layer 1: Browser
Cache-Control headers, service worker, local storage. TTL controlled by the server.

### Layer 2: CDN Edge
Shared cache at geographic edge locations. Controlled by `s-maxage` and cache tags.

### Layer 3: API Gateway
Response cache for authenticated or unauthenticated endpoints. Short TTLs (seconds to minutes).

### Layer 4: Application
In-process cache (LRU map, memoization). Fastest but per-instance (not shared).

### Layer 5: Distributed Cache
Redis or Memcached. Shared across instances. Sub-millisecond access.

### Layer 6: Database
Query cache, buffer pool, materialized views. Managed by the database engine.

### Layer 7: Operating System
Page cache, inode cache, dentry cache. Managed by the kernel.

## The Debugging Challenge

When a user reports stale data, you need to determine which cache layer is serving the stale content. Systematic cache inspection from outer to inner layers is the approach.

## Cache Coherence

The more cache layers you have, the harder it is to maintain coherence. Event-driven invalidation across all layers is the ideal but complex to implement.

See [[perf-001]] for cache invalidation and [[perf-005]] for CDN caching.
