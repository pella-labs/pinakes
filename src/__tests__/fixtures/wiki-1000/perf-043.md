# Event-Driven Architecture Performance

## Event Sourcing Overhead

**Event sourcing** stores every state change as an immutable event. The tradeoff: rich audit trail and time-travel, but reads require replaying events or maintaining projections.

## Projection Performance

Projections materialize read models from event streams. Key concerns:

- **Rebuild time**: how long to rebuild from scratch (impacts recovery)
- **Lag**: how far behind the projection is from the latest event
- **Storage**: denormalized projections trade space for read speed

## CQRS Performance Profile

The **Command Query Responsibility Segregation** pattern separates write and read models. Performance characteristics:

- Writes are fast (append to event store)
- Reads are fast (query denormalized projections)
- Consistency is eventual (projection lag)
- Complexity is high (multiple data models)

## Snapshotting

For aggregates with many events, loading requires replaying all events. **Snapshots** store periodic aggregate state, reducing replay to events-since-last-snapshot.

Rule of thumb: snapshot every 100 events or when replay time exceeds 100ms.

## Backpressure in Event Pipelines

When event producers outpace consumers, apply backpressure:

- Bounded queues with block-on-full semantics
- Rate limiting at the producer
- Consumer-driven flow control (pull vs push)

See [[perf-010]] for async processing and [[perf-012]] for Kafka.
