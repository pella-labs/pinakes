# Slow Consumer Pattern in Kafka

## Symptoms

- Consumer lag growing monotonically
- Consumer group rebalancing frequently (exceeding `max.poll.interval.ms`)
- Backlog of unprocessed messages

## Root Causes

### Processing Too Slow
Each message takes too long to process. The consumer can't keep up with the production rate.

### Uneven Partition Assignment
Some partitions receive more traffic than others. The consumer assigned to hot partitions falls behind.

### Blocking I/O in Consumer Loop
Synchronous database calls or HTTP requests inside the consume loop block processing.

## Solutions

### Increase Parallelism
Add more consumers to the group (up to the partition count). Each consumer handles fewer partitions.

### Batch Processing
Process messages in batches instead of one at a time. Batch database inserts and API calls.

### Async Processing
Decouple message consumption from processing. Consume messages quickly into an in-memory buffer, process asynchronously.

```typescript
const buffer: Message[] = [];
const BATCH_SIZE = 100;

consumer.on('message', (msg) => {
  buffer.push(msg);
  if (buffer.length >= BATCH_SIZE) {
    const batch = buffer.splice(0, BATCH_SIZE);
    processBatch(batch).then(() => consumer.commit());
  }
});
```

### Back-Pressure
If the consumer truly can't keep up, apply back-pressure to the producer or accept data loss for non-critical streams.

See [[perf-041]] for Kafka consumer tuning and [[perf-012]] for Kafka fundamentals.
