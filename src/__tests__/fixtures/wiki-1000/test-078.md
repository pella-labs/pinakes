# Testing Batch Operations

Batch operations process multiple items at once. Testing them requires verifying both individual and collective behavior.

## All-or-Nothing Semantics

```typescript
it('rolls back entire batch on single failure', async () => {
  const items = [
    { id: '1', valid: true },
    { id: '2', valid: true },
    { id: '3', valid: false }, // will fail validation
  ];

  await expect(batchCreate(items)).rejects.toThrow();

  // None should be created
  expect(await count()).toBe(0);
});
```

## Partial Success

```typescript
it('reports individual item results', async () => {
  const results = await batchCreateWithPartialSuccess(items);

  expect(results.succeeded).toHaveLength(2);
  expect(results.failed).toHaveLength(1);
  expect(results.failed[0].reason).toBe('Validation failed');
});
```

## Performance at Scale

Test batch operations with realistic sizes:

```typescript
it('handles 10,000 items within 5 seconds', async () => {
  const items = Array.from({ length: 10000 }, (_, i) => ({
    id: String(i),
    data: `item-${i}`,
  }));

  const start = Date.now();
  await batchCreate(items);
  expect(Date.now() - start).toBeLessThan(5000);
});
```

## Idempotency

Running a batch twice with the same items should not create duplicates. Test this explicitly.

See [[test-039]] for concurrency considerations in batch processing.
