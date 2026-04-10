---
title: Apache Kafka Fundamentals
tags: [kafka, streaming, messaging]
created: 2025-12-01
---
# Apache Kafka Fundamentals

## Log-Based Messaging

Unlike traditional message queues, Kafka is a **distributed commit log**. Messages are appended to partitions and retained for a configurable duration regardless of consumption. Consumers track their own offset.

## Core Concepts

- **Topic**: a named feed of messages
- **Partition**: an ordered, immutable sequence of messages within a topic
- **Consumer Group**: a set of consumers that divide partition ownership
- **Offset**: a sequential ID assigned to each message in a partition

## Partition Strategy

Partitions are the unit of parallelism. More partitions = more throughput, but also more overhead:

- Each partition is an open file handle on every broker
- Rebalancing time increases with partition count
- End-to-end latency increases with partition count

Rule of thumb: start with `max(throughput_mb / 10, consumer_count)` partitions.

## Consumer Groups and Rebalancing

When a consumer joins or leaves a group, Kafka triggers a **rebalance**. During rebalance, all consumers in the group pause processing. Use **cooperative sticky assignment** to minimize disruption.

## Kafka vs RabbitMQ

| Feature | Kafka | RabbitMQ |
|---|---|---|
| Model | Log-based | Queue-based |
| Replay | Yes (offset reset) | No (consumed = gone) |
| Ordering | Per-partition | Per-queue |
| Throughput | Very high | High |
| Latency | Higher | Lower |

See [[perf-011]] for RabbitMQ details.

## Kafka Retention Policies

### Time-Based Retention
Keep messages for a specified duration. After the retention period, old segments are deleted.

```yaml
log.retention.hours: 168    # 7 days
log.retention.bytes: -1     # no size limit
```

### Size-Based Retention
Keep up to a specified total size per partition. Oldest segments are deleted when the limit is exceeded.

### Compaction
For topics that represent current state (configuration, user profiles), **log compaction** retains only the latest value per key. All intermediate updates are removed during compaction.

```yaml
cleanup.policy: compact
min.cleanable.dirty.ratio: 0.5
```

## Kafka Connect

**Kafka Connect** streams data between Kafka and external systems without writing consumer/producer code. Common connectors:

- **JDBC Source**: stream database changes to Kafka
- **Elasticsearch Sink**: index Kafka messages in Elasticsearch
- **S3 Sink**: archive Kafka messages to S3
- **Debezium**: capture database change events (CDC)

## Schema Registry

Use a **schema registry** (Confluent, Apicurio) to enforce message schemas. Producers register schemas; consumers validate against them. This prevents breaking changes from propagating through the pipeline.

Supported formats: Avro, Protobuf, JSON Schema. Avro is the most common choice for Kafka due to its compact binary encoding and schema evolution support.
