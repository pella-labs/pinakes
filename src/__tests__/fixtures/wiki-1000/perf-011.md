# RabbitMQ Architecture and Patterns

## Exchange Types

RabbitMQ routes messages through **exchanges** before they reach queues. The exchange type determines routing behavior.

### Direct Exchange

Routes messages to queues whose binding key exactly matches the routing key. One-to-one mapping.

### Topic Exchange

Routes based on wildcard patterns. `order.*.created` matches `order.us.created` but not `order.us.updated`. The `#` wildcard matches zero or more words.

### Fanout Exchange

Broadcasts to all bound queues regardless of routing key. Ideal for event notification where multiple consumers need every message.

## Prefetch and Fair Dispatch

By default, RabbitMQ dispatches messages round-robin. With `prefetch_count = 1`, a worker only receives a new message after acknowledging the previous one. This prevents fast consumers from being starved while slow consumers accumulate unprocessed messages.

```typescript
const channel = await connection.createChannel();
await channel.prefetch(1);
await channel.consume('orders', async (msg) => {
  await processOrder(JSON.parse(msg.content.toString()));
  channel.ack(msg);
});
```

## Durability

- **Durable exchanges** survive broker restarts
- **Durable queues** survive broker restarts  
- **Persistent messages** are written to disk

All three must be enabled for messages to survive a crash.

## High Availability

Use **quorum queues** (RabbitMQ 3.8+) instead of classic mirrored queues. Quorum queues use Raft consensus and are safer under network partitions.

See [[perf-010]] for general async patterns and [[perf-012]] for Kafka comparison.
