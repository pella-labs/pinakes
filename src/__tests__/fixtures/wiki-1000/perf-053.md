# Database Sharding

## When to Shard

Sharding is the last resort for database scaling. Try everything else first: query optimization, read replicas, caching, archiving old data. Shard only when a single primary cannot handle the write load.

## Sharding Strategies

### Range-Based
Partition by ranges of a key (e.g., user IDs 1-1M on shard 1, 1M-2M on shard 2). Simple but prone to hotspots if access isn't uniform.

### Hash-Based
Hash the shard key and modulo by shard count. Even distribution but makes range queries across shards impossible.

### Directory-Based
A lookup table maps keys to shards. Most flexible but the directory is a single point of failure and a potential bottleneck.

## Cross-Shard Queries

The hardest part of sharding. Options:

- Scatter-gather: query all shards, merge results. Works but slow.
- Denormalize: duplicate data so queries stay local to one shard.
- Application-level joins: fetch from multiple shards in application code.

## Resharding

When you outgrow your shard count, you need to redistribute data. This is operationally complex. Use consistent hashing with virtual nodes to minimize data movement during resharding.

## Alternatives to Sharding

- Vertical partitioning: move tables to separate databases
- Multi-tenancy with schema-per-tenant
- Time-based partitioning (archive old data)
- NewSQL databases with built-in sharding (CockroachDB, TiDB)

See [[perf-052]] for read replicas.
