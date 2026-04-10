# Testing Eventual Consistency

In distributed systems, data may be temporarily inconsistent. Testing eventual consistency requires patience and assertions on convergence.

## Read-After-Write Consistency

```typescript
it('reads own writes eventually', async () => {
  await service.write({ key: 'x', value: 42 });

  // May not be immediately visible
  await waitFor(async () => {
    const result = await service.read('x');
    expect(result).toBe(42);
  }, { timeout: 5000, interval: 100 });
});
```

## Conflict Resolution

When two writers update the same key concurrently, test the resolution strategy:

```typescript
it('resolves concurrent writes with last-writer-wins', async () => {
  await Promise.all([
    service.write({ key: 'x', value: 'A', timestamp: 100 }),
    service.write({ key: 'x', value: 'B', timestamp: 200 }),
  ]);

  await waitFor(async () => {
    const result = await service.read('x');
    expect(result).toBe('B'); // later timestamp wins
  });
});
```

## Convergence

Test that replicas converge to the same state after a network partition heals:

```typescript
it('converges after partition heals', async () => {
  // Write to replica 1 during partition
  await replica1.write({ key: 'x', value: 1 });
  // Write to replica 2 during partition
  await replica2.write({ key: 'y', value: 2 });

  // Heal partition
  await healPartition(replica1, replica2);

  // Both replicas should eventually have both values
  await waitFor(async () => {
    expect(await replica1.read('y')).toBe(2);
    expect(await replica2.read('x')).toBe(1);
  });
});
```

See [[test-032]] for microservice testing and [[test-091]] for idempotency.
