# Tracing in Message Queue Systems

## The Context Propagation Problem

When a message is published to a queue and consumed later (possibly by a different service), the trace context must be carried through the message. Otherwise, the consumer's trace is disconnected from the producer's.

## Propagating Context Through Messages

```typescript
// Producer: inject trace context into message headers
const headers: Record<string, string> = {};
propagation.inject(context.active(), headers);

await producer.send({
  topic: 'orders',
  messages: [{
    key: order.id,
    value: JSON.stringify(order),
    headers,
  }],
});

// Consumer: extract trace context from message headers
await consumer.run({
  eachMessage: async ({ message }) => {
    const parentContext = propagation.extract(ROOT_CONTEXT, message.headers);
    const span = tracer.startSpan('process_order', {}, parentContext);
    // ... process message ...
    span.end();
  },
});
```

## Linking Traces

For batch consumers that process multiple messages at once, use **span links** to connect the consumer span to multiple producer spans rather than creating a single parent.

## Async Trace Patterns

- **Fire-and-forget**: producer span ends at publish. Consumer starts a new trace linked to the producer span.
- **Request-reply**: producer span spans until the reply arrives. Consumer span is a child of the producer span.
- **Batch processing**: one consumer span linked to all producer spans in the batch.

See [[perf-018]] for tracing patterns and [[perf-012]] for Kafka.
