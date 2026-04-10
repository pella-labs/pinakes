---
source: extracted
---
# Competing Consumers Pattern

## Problem

A single consumer can't keep up with message throughput.

## Solution

Deploy multiple instances of the same consumer. The message broker distributes messages across consumers so each message is processed by exactly one consumer.

## Requirements

- Messages must be processed **independently** (no ordering dependency between messages)
- Processing must be **idempotent** (messages might be delivered twice during rebalancing)
- The broker must support **competing consumer groups** (Kafka consumer groups, RabbitMQ queues)

## Kafka Consumer Groups

```
Topic: orders (4 partitions)

Consumer Group: order-processors
  Consumer A → Partition 0, 1
  Consumer B → Partition 2, 3

Scale up to 4 consumers → 1 partition each
Scale up to 5 consumers → one is idle (max parallelism = partition count)
```

## Scaling Rule

For Kafka: number of consumers in a group <= number of partitions. Plan partition count based on expected peak throughput.

See [[arch-003]], [[arch-065]].
