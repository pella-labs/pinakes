# Testing Idempotency

**Idempotent** operations produce the same result regardless of how many times they execute. This is critical for retry safety.

## HTTP Idempotency

```typescript
it('PUT is idempotent', async () => {
  const data = { name: 'Alice', email: 'alice@test.com' };

  await api.put('/users/1', data);
  await api.put('/users/1', data);
  await api.put('/users/1', data);

  const user = await api.get('/users/1');
  expect(user.data.name).toBe('Alice');

  const allUsers = await api.get('/users');
  expect(allUsers.data.filter(u => u.id === 1)).toHaveLength(1);
});
```

## Idempotency Keys

For non-idempotent operations (POST), use idempotency keys:

```typescript
it('deduplicates with idempotency key', async () => {
  const key = 'unique-request-123';

  const res1 = await api.post('/orders', orderData, {
    headers: { 'Idempotency-Key': key },
  });
  const res2 = await api.post('/orders', orderData, {
    headers: { 'Idempotency-Key': key },
  });

  expect(res1.data.id).toBe(res2.data.id);
  expect(await countOrders()).toBe(1);
});
```

## Database Operations

Test that upsert operations are truly idempotent. Running an upsert twice should not create duplicates or increment counters.

## Message Processing

Test that processing the same message twice produces the same result. See [[test-031]] for event-driven testing.
