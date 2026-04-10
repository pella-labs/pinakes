# CQRS with Event Sourcing

## Combined Pattern

When you combine **CQRS** and **event sourcing**, the write side stores events, and the read side builds projections from those events.

## Architecture

```
Command → [Command Handler] → [Event Store] → [Event Bus]
                                                    |
                                    +---------------+---------------+
                                    |               |               |
                              [Projection A]  [Projection B]  [Projection C]
                                    |               |               |
                              [Read DB A]     [Read DB B]     [Read DB C]
```

## Projections

Each projection builds a read-optimized view:

```typescript
class OrderSummaryProjection {
  async handle(event: DomainEvent): Promise<void> {
    switch (event.type) {
      case 'OrderCreated':
        await this.db.insert('order_summaries', {
          id: event.orderId,
          status: 'created',
          itemCount: event.items.length,
          createdAt: event.timestamp,
        });
        break;
      case 'OrderShipped':
        await this.db.update('order_summaries', event.orderId, {
          status: 'shipped',
          shippedAt: event.timestamp,
        });
        break;
    }
  }
}
```

## Rebuild Projections

If a projection is wrong, delete it and replay all events. This is the killer feature.

See [[arch-004]], [[arch-005]], [[arch-003]].
