# CQRS Pattern

**Command Query Responsibility Segregation** separates the read model from the write model. Commands mutate state. Queries return data. They use different models, often different data stores.

## Why Separate Reads and Writes

In most applications, read and write patterns differ dramatically:

- Writes are transactional, enforce invariants, and touch small aggregates
- Reads are often denormalized, span multiple aggregates, and require flexible filtering

Forcing both through the same model creates compromises. The read side wants flat, pre-joined views. The write side wants normalized, invariant-enforcing aggregates.

## Implementation

```typescript
// Command side — enforces business rules
class PlaceOrderHandler {
  constructor(
    private readonly repo: OrderRepository,
    private readonly inventory: InventoryService,
  ) {}

  async handle(cmd: PlaceOrderCommand): Promise<OrderId> {
    const order = Order.create(cmd.customerId, cmd.items);
    await this.inventory.reserve(cmd.items);
    await this.repo.save(order);
    return order.id;
  }
}

// Query side — optimized for reads, no business logic
class OrderQueryService {
  constructor(private readonly readDb: ReadDatabase) {}

  async getOrderSummary(orderId: string): Promise<OrderSummaryDto> {
    return this.readDb.query(
      `SELECT o.id, o.status, c.name as customer_name,
              SUM(i.price * i.quantity) as total
       FROM order_read_view o
       JOIN customers c ON o.customer_id = c.id
       JOIN order_items_view i ON o.id = i.order_id
       WHERE o.id = ?
       GROUP BY o.id`,
      [orderId]
    );
  }
}
```

## Event Sourcing Synergy

CQRS pairs naturally with **event sourcing**. The write side stores events as the source of truth. The read side projects those events into queryable views. This gives you a complete audit log and the ability to rebuild read models from scratch.

See [[arch-002]] for event infrastructure and [[database-patterns]] for read model projection patterns.

## Consistency

The read model is **eventually consistent** with the write model. There's a window where a command has been processed but the read model hasn't caught up. For most use cases this is fine. For cases where it's not, return the result directly from the command handler (bypassing the read model for that specific response).
