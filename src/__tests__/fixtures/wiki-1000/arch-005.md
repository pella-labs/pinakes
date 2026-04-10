# Event Sourcing

## Core Idea

Instead of storing current state, store a sequence of **events** that led to the current state. The current state is derived by replaying the event stream.

## Benefits

- Complete audit trail by construction
- Time-travel debugging (replay to any point)
- Natural fit with CQRS

## Implementation Notes

Events are stored in an **append-only event store**. Each aggregate has its own event stream, keyed by aggregate ID.

```
Stream: order-12345
  [1] OrderCreated { customerId: "c1", items: [...] }
  [2] ItemAdded { sku: "SKU-99", qty: 2 }
  [3] OrderSubmitted { submittedAt: "2024-06-15T10:00:00Z" }
  [4] PaymentReceived { amount: 4999, currency: "USD" }
```

## Snapshots

For aggregates with many events (>1000), take periodic snapshots to avoid replaying the full stream on every load.

## Caveats

- Schema evolution is harder than in a mutable DB
- Debugging projections that fall behind is painful
- Not every domain benefits from this level of traceability

See [[arch-004]], [[arch-010]].
