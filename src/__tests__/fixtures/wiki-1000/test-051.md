# Testing Queue Systems

Message queues decouple producers and consumers. Testing them requires verifying message delivery, ordering, and error handling.

## In-Memory Queue for Tests

```typescript
class TestQueue<T> {
  private messages: T[] = [];
  private consumers: ((msg: T) => Promise<void>)[] = [];

  async publish(msg: T) {
    this.messages.push(msg);
    for (const consumer of this.consumers) {
      await consumer(msg);
    }
  }

  subscribe(handler: (msg: T) => Promise<void>) {
    this.consumers.push(handler);
  }

  get published() { return [...this.messages]; }
}
```

## Testing Message Ordering

Some queues guarantee ordering (Kafka partitions, SQS FIFO). Test that your consumer processes messages in the correct order.

## Dead Letter Handling

Messages that fail processing repeatedly should be moved to a **dead letter queue**. Test the retry count, the DLQ routing, and that the original message is preserved for debugging.

## Backpressure

When the consumer can't keep up with the producer, test that the system handles backpressure gracefully. Does it drop messages, buffer them, or block the producer?

See [[test-031]] for event-driven testing and [[test-048]] for background job testing.
