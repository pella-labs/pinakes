# Backpressure

## What It Is

**Backpressure** is a mechanism for a downstream component to signal that it's overwhelmed, causing upstream components to slow down.

## Without Backpressure

Producer is fast, consumer is slow → unbounded queue grows → OOM crash.

## Strategies

### Bounded Queues
When the queue is full, block the producer or drop messages.

### Rate Limiting
Producer limits its own rate based on consumer feedback.

### Reactive Streams
Pull-based model: consumer requests N items, producer sends at most N.

```typescript
interface Subscriber<T> {
  onSubscribe(subscription: Subscription): void;
  onNext(value: T): void;
  onError(error: Error): void;
  onComplete(): void;
}

interface Subscription {
  request(n: number): void;  // consumer pulls
  cancel(): void;
}
```

### TCP Flow Control
TCP itself implements backpressure via sliding window. If the receiver's buffer is full, it advertises a zero window, and the sender stops.

## In Practice

Node.js streams have built-in backpressure. If you `pipe()` a readable to a writable, the readable pauses when the writable's buffer is full.

See [[arch-003]], [[arch-078]].
