---
source: extracted
---
# Repository Pattern

## Purpose

A **repository** provides a collection-like interface for accessing domain objects. It encapsulates the query logic and persistence mechanism.

## Interface

```typescript
interface OrderRepository {
  findById(id: OrderId): Promise<Order | null>;
  findByCustomer(customerId: CustomerId): Promise<Order[]>;
  save(order: Order): Promise<void>;
  delete(id: OrderId): Promise<void>;
}
```

## Implementation

The concrete implementation knows about the database:

```typescript
class SqlOrderRepository implements OrderRepository {
  constructor(private db: Database) {}

  async findById(id: OrderId): Promise<Order | null> {
    const row = await this.db.query('SELECT * FROM orders WHERE id = ?', [id.value]);
    return row ? this.toDomain(row) : null;
  }

  async save(order: Order): Promise<void> {
    await this.db.query(
      'INSERT INTO orders (id, customer_id, status) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET status = ?',
      [order.id.value, order.customerId.value, order.status, order.status]
    );
  }
}
```

## Testing

Replace with an in-memory implementation for unit tests:

```typescript
class InMemoryOrderRepository implements OrderRepository {
  private orders = new Map<string, Order>();
  // ...
}
```

See [[arch-006]], [[arch-010]], [[testing-integration]].
