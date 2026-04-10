# Load Balancing Algorithms

## Round Robin

Distribute requests evenly across instances. Simple, works well when instances are homogeneous.

## Weighted Round Robin

Assign weights based on instance capacity. A beefy instance gets more traffic.

## Least Connections

Send to the instance with the fewest active connections. Good for long-lived connections (WebSockets, gRPC streaming).

## Consistent Hashing

Hash the request key to a position on a ring. Each instance owns a range. Adding/removing instances only redistributes a fraction of keys. Used by caches and distributed stores.

## Random with Two Choices

Pick two random instances, send to the one with fewer connections. Surprisingly effective — avoids the thundering herd.

## Health-Aware

Combine any algorithm with health checking. Remove unhealthy instances from the pool.

See [[arch-012]], [[perf-caching]], [[database-sharding]].
