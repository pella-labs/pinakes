# Consensus Algorithms

## The Problem

In a distributed system with replicated state, how do nodes agree on a value even when some nodes fail?

## Raft

Designed for understandability. Used by etcd, Consul, CockroachDB.

### Leader Election
1. Nodes start as followers
2. If a follower doesn't hear from a leader within a timeout, it becomes a candidate
3. Candidate requests votes; majority wins
4. Leader sends heartbeats to maintain authority

### Log Replication
1. Client sends request to leader
2. Leader appends to its log, replicates to followers
3. Once a majority acknowledges, entry is committed
4. Leader notifies client

## Paxos

Older, harder to understand. Variants: Multi-Paxos, Cheap Paxos, Fast Paxos.

## Practical Use

You rarely implement consensus yourself. Use systems that implement it:
- **etcd** (Raft) — Kubernetes' brain
- **ZooKeeper** (ZAB) — Hadoop ecosystem
- **Consul** (Raft) — service mesh, KV store

See [[arch-066]], [[database-sharding]].
