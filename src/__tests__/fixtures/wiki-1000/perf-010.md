# Async Processing with Message Queues

## Decouple or Die

Synchronous request-response is fine until your API needs to send an email, resize an image, and update a search index — all in the same request. **Message queues** let you defer non-critical work to background processors.

## When to Go Async

- Work that takes > 100ms and isn't needed for the response
- Operations that can be retried independently
- Fan-out to multiple downstream systems
- Spike absorption (queue buffers bursts that would overwhelm downstream)

## Queue Semantics

### At-Most-Once

Message is delivered zero or one times. Fast, no deduplication needed, but messages can be lost.

### At-Least-Once

Message is delivered one or more times. Requires **idempotent consumers** to handle duplicates.

### Exactly-Once

Technically impossible in distributed systems. Approximated via at-least-once delivery plus consumer-side deduplication using a **processed message ID table**.

## Dead Letter Queues

Messages that fail processing after N retries should be routed to a **dead letter queue** (DLQ). This prevents poison messages from blocking the main queue.

- Set max retry count (typically 3-5)
- Route failures to DLQ
- Alert on DLQ depth
- Build tooling to inspect and replay DLQ messages

See [[perf-011]] for RabbitMQ specifics and [[perf-012]] for Kafka.
