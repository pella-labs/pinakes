---
source: extracted
---
# Dead Letter Queue

## Problem

Messages that can't be processed (malformed, causing exceptions, exceeding retries) block the queue.

## Solution

After N failed processing attempts, move the message to a **dead letter queue** (DLQ). Continue processing other messages.

## Configuration (RabbitMQ)

```json
{
  "queue": "orders",
  "arguments": {
    "x-dead-letter-exchange": "dlx",
    "x-dead-letter-routing-key": "orders.dead",
    "x-message-ttl": 86400000
  }
}
```

## Monitoring

- Alert when DLQ depth exceeds threshold
- Build a UI for inspecting and replaying DLQ messages
- Track DLQ rate as a service health metric

## Common Causes

- Schema mismatches between producer and consumer
- Bugs in consumer logic
- Transient failures that outlast retry budget
- Poison messages that always fail

See [[arch-003]], [[monitoring-prometheus]].
