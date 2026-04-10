# Redis Cluster Topology and Failover

## Cluster Architecture

A Redis Cluster distributes data across multiple **primary nodes**, each responsible for a subset of the 16384 hash slots. Each primary has one or more **replicas** for high availability.

## Hash Slot Distribution

Redis uses CRC16 of the key modulo 16384 to determine slot assignment. Keys with the same **hash tag** (the substring between `{` and `}`) are guaranteed to map to the same slot.

## Failover Mechanics

When a primary becomes unreachable, the cluster initiates **automatic failover**:

1. Replicas detect the primary is down via heartbeat timeout
2. One replica is elected to replace the primary
3. The new primary announces its slot ownership
4. Clients update their routing table

The failover window is typically 1-3 seconds. During this window, writes to the affected slots will fail. Applications must implement **retry logic** with exponential backoff.

## Split-Brain Prevention

Redis Cluster uses a quorum-based approach where a majority of primaries must agree that a node is unreachable before failover proceeds. The `cluster-node-timeout` setting controls how long nodes wait before marking a peer as failed.

## Monitoring Cluster Health

Key metrics to watch:
- **cluster_state**: should always be `ok`
- **cluster_slots_assigned**: should be 16384
- **cluster_slots_ok**: should match assigned
- Replication lag per replica
