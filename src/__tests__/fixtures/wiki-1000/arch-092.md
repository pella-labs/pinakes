# Hexagonal Testing Strategy

## Testing by Ring

### Domain Layer (innermost)
Pure unit tests. No mocks needed — domain objects have no dependencies.

```typescript
describe('Order', () => {
  it('cannot submit an empty order', () => {
    const order = new Order(OrderId.generate(), customerId);
    expect(() => order.submit()).toThrow('Empty order');
  });
});
```

### Application Layer
Unit tests with port interfaces stubbed or mocked.

### Adapter Layer
Integration tests against real infrastructure.

```typescript
describe('SqlOrderRepository', () => {
  it('round-trips an order', async () => {
    const repo = new SqlOrderRepository(testDb);
    const order = OrderFactory.create();
    await repo.save(order);
    const loaded = await repo.findById(order.id);
    expect(loaded).toEqual(order);
  });
});
```

### Full Stack
E2E tests through the primary adapter (HTTP, CLI).

## Coverage Strategy

- 80%+ coverage in domain and application layers (high value, cheap tests)
- 60%+ coverage in adapters (integration tests are slower)
- Selective E2E tests for critical paths

See [[arch-009]], [[testing-integration]], [[arch-010]].
