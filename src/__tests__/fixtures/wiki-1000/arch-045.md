---
source: extracted
confidence: ambiguous
---
# Decorator Pattern

## Purpose

Add behavior to an object without modifying its class. Decorators wrap the original object and delegate to it.

## Example: Caching Repository

```typescript
class CachingOrderRepository implements OrderRepository {
  constructor(
    private inner: OrderRepository,
    private cache: Cache,
  ) {}

  async findById(id: OrderId): Promise<Order | null> {
    const cached = await this.cache.get(`order:${id.value}`);
    if (cached) return cached;

    const order = await this.inner.findById(id);
    if (order) await this.cache.set(`order:${id.value}`, order, 300);
    return order;
  }

  async save(order: Order): Promise<void> {
    await this.inner.save(order);
    await this.cache.delete(`order:${order.id.value}`);
  }
}
```

## Stacking

Decorators compose:

```typescript
const repo = new LoggingRepository(
  new CachingRepository(
    new SqlOrderRepository(db),
    cache
  ),
  logger
);
```

See [[perf-caching]], [[arch-017]], [[arch-030]].
