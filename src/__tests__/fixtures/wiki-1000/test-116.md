
# Testing Pub/Sub Systems

Publish/subscribe patterns decouple producers from consumers. Testing requires verifying message delivery, filtering, and ordering.

## Basic Publish and Subscribe

```typescript
it('delivers message to subscriber', async () => {
  const bus = new PubSub();
  const received: string[] = [];

  bus.subscribe('user.created', (msg) => received.push(msg.name));
  bus.publish('user.created', { name: 'Alice' });

  await bus.drain();
  expect(received).toEqual(['Alice']);
});
```

## Topic Filtering

```typescript
it('only delivers to matching subscriptions', async () => {
  const bus = new PubSub();
  const orderMsgs: any[] = [];
  const userMsgs: any[] = [];

  bus.subscribe('order.*', (msg) => orderMsgs.push(msg));
  bus.subscribe('user.*', (msg) => userMsgs.push(msg));

  bus.publish('order.created', { id: 1 });
  bus.publish('user.created', { id: 2 });

  await bus.drain();
  expect(orderMsgs).toHaveLength(1);
  expect(userMsgs).toHaveLength(1);
});
```

## Multiple Subscribers

Test that all subscribers receive the same message and that one subscriber's failure doesn't affect others.

## Unsubscribe

```typescript
it('stops receiving after unsubscribe', async () => {
  const bus = new PubSub();
  const received: any[] = [];

  const sub = bus.subscribe('events', (msg) => received.push(msg));
  bus.publish('events', 'first');

  sub.unsubscribe();
  bus.publish('events', 'second');

  await bus.drain();
  expect(received).toEqual(['first']);
});
```

See [[test-051]] for queue system testing and [[test-031]] for event-driven system testing.
