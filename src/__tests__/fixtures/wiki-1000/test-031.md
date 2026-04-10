# Testing Event-Driven Systems

Event-driven architectures present unique testing challenges. Events are asynchronous, may arrive out of order, and can trigger cascading side effects.

## Unit Testing Event Handlers

Test handlers in isolation by directly invoking them with test events:

```typescript
it('processes order created event', async () => {
  const event: OrderCreatedEvent = {
    type: 'order.created',
    data: { orderId: '123', total: 99.99 },
    timestamp: new Date(),
  };

  const result = await handleOrderCreated(event);
  expect(result.notificationSent).toBe(true);
});
```

## Testing Event Ordering

Some systems depend on event ordering. Test that out-of-order delivery is handled correctly:

- What happens if a "shipped" event arrives before "created"?
- What if a "deleted" event arrives for an unknown entity?
- What if the same event is delivered twice?

## Integration Testing with Event Bus

Use an in-memory event bus for integration tests:

```typescript
const bus = new InMemoryEventBus();
const handler = new OrderHandler(bus);

bus.emit('order.created', { orderId: '1' });
await bus.drain(); // wait for all handlers to complete

const order = await orderRepo.find('1');
expect(order.status).toBe('processing');
```

## Idempotency

Events may be delivered more than once. Every handler must be **idempotent**: processing the same event twice should produce the same result as processing it once. Test this explicitly.

See [[test-025]] for general async testing patterns.
