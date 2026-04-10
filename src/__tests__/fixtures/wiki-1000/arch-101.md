# Shared Nothing Architecture

## Principle

Each node in a **shared nothing** architecture has its own CPU, memory, and storage. Nodes communicate only via the network.

## Benefits

- Linear horizontal scaling
- No single point of failure (if designed correctly)
- No contention on shared resources

## Examples

- PostgreSQL with Citus (sharded, each node owns its data)
- Cassandra (every node is equal, data partitioned by consistent hash)
- Kafka (each partition lives on one broker)

## Trade-offs

- Cross-node queries are expensive (scatter-gather)
- Rebalancing data when adding/removing nodes
- More complex to reason about than shared-everything

See [[database-sharding]], [[arch-065]], [[arch-066]].
