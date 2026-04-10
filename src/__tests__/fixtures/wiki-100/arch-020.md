---
source: extracted
---

# Dependency Injection

**Dependency injection** (DI) is a technique where an object receives its dependencies from the outside rather than creating them internally. It is the practical implementation of the **Dependency Inversion Principle** — the D in SOLID.

## Three Forms

### Constructor Injection (Preferred)

```typescript
class OrderService {
  constructor(
    private readonly repo: OrderRepository,
    private readonly events: EventPublisher,
    private readonly logger: Logger,
  ) {}

  async placeOrder(cmd: PlaceOrderCommand): Promise<Order> {
    const order = Order.create(cmd);
    await this.repo.save(order);
    await this.events.publish(new OrderCreated(order));
    this.logger.info('Order placed', { orderId: order.id });
    return order;
  }
}
```

### Property Injection

Set dependencies via properties after construction. Useful for optional dependencies but makes the object partially initialized — avoid in most cases.

### Method Injection

Pass the dependency as a method parameter. Useful when the dependency varies per call (e.g., a request-scoped context).

## DI Containers

DI containers (InversifyJS, tsyringe, Awilix) automate dependency resolution. They maintain a registry of bindings (interface to implementation) and construct object graphs automatically.

For small projects, **manual wiring** in a composition root is simpler and more explicit. No magic, no decorators, just constructor calls at the entry point.

## Relationship to Architecture

DI is the mechanism that makes [[arch-003]] hexagonal architecture and [[arch-009]] clean architecture work in practice. Ports are interfaces; adapters are injected implementations. Without DI, the dependency arrows would point outward instead of inward.

## Testing

DI makes testing straightforward — inject test doubles (stubs, fakes, spies) instead of real implementations. No monkey-patching, no module-level mocking, no import hacks.
