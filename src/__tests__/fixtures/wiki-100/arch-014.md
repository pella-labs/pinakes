---
source: extracted
---

# Event Sourcing

**Event sourcing** stores the state of an entity as a sequence of state-changing events rather than the current state. To reconstruct current state, replay all events from the beginning (or from a snapshot).

## Core Concept

Instead of storing `{ balance: 150 }`, store:

1. `AccountOpened { initialDeposit: 100 }`
2. `MoneyDeposited { amount: 200 }`
3. `MoneyWithdrawn { amount: 150 }`

The current balance is derived by replaying these events: `100 + 200 - 150 = 150`.

## Event Store

The event store is an append-only log. Events are immutable — you never update or delete them. Common implementations:

- **EventStoreDB**: purpose-built, supports projections natively
- **PostgreSQL with an events table**: simpler, good enough for many use cases
- **Kafka with compaction disabled**: when you need high-throughput event streaming

```typescript
interface EventStore {
  append(streamId: string, events: DomainEvent[], expectedVersion: number): Promise<void>;
  readStream(streamId: string, fromVersion?: number): AsyncIterable<DomainEvent>;
  readAll(fromPosition?: bigint): AsyncIterable<DomainEvent>;
}
```

## Snapshots

For aggregates with long event histories, replaying thousands of events on every load is expensive. **Snapshots** capture the state at a point in time. Load the snapshot, then replay only events after it.

## Projections

**Projections** (also called read models or materializers) subscribe to the event stream and build queryable views optimized for specific read patterns. This is the read side of [[arch-005]] CQRS.

## Benefits

- Complete audit trail for free
- Temporal queries ("what was the state at 3pm yesterday?")
- Easy debugging — replay events to reproduce any state
- Enables [[arch-002]] event-driven patterns naturally

## Challenges

- Eventual consistency between write and read models
- Schema evolution of events over time (upcasting)
- Event store can grow large — archival strategies needed
