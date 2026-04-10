# CAP Theorem

## Statement

In a distributed system, you can have at most two of:
- **Consistency** — every read receives the most recent write
- **Availability** — every request receives a response
- **Partition tolerance** — the system works despite network partitions

## The Real Trade-off

Partitions are inevitable in distributed systems. So the real choice is between **consistency** and **availability** during a partition.

- **CP systems** (e.g., HBase, ZooKeeper) — sacrifice availability during partition
- **AP systems** (e.g., Cassandra, DynamoDB) — sacrifice consistency during partition

## PACELC

An extension: "if **P**artition, choose **A** or **C**; **E**lse, choose **L**atency or **C**onsistency."

Even without partitions, there's a trade-off between latency and consistency. DynamoDB is PA/EL (available during partition, low latency otherwise). ZooKeeper is PC/EC (consistent always, higher latency).

## Practical Implication

Most services don't need strong consistency everywhere. Use it for critical paths (payments) and eventual consistency for the rest (analytics, recommendations).

See [[arch-040]], [[database-sharding]].
