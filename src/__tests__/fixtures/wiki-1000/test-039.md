# Testing Concurrency

Concurrent code is notoriously difficult to test because bugs depend on timing and thread scheduling.

## Race Condition Detection

Use stress testing to expose race conditions:

```typescript
it('handles concurrent increments', async () => {
  const counter = new AtomicCounter(0);

  await Promise.all(
    Array.from({ length: 1000 }, () => counter.increment())
  );

  expect(counter.value).toBe(1000);
});
```

## Mutex and Lock Testing

Verify that critical sections are properly protected:

```typescript
it('prevents double-spending', async () => {
  const account = await createAccount(100);

  const results = await Promise.allSettled([
    withdraw(account.id, 80),
    withdraw(account.id, 80),
  ]);

  const successes = results.filter(r => r.status === 'fulfilled');
  expect(successes).toHaveLength(1);

  const balance = await getBalance(account.id);
  expect(balance).toBe(20);
});
```

## Deadlock Detection

Test scenarios where multiple resources are acquired in different orders. If the system has deadlock detection, verify it works. If not, document the lock ordering convention and test that it's followed.

## Worker Thread Testing

Node.js worker threads require special testing patterns. Test that messages are correctly passed between main and worker threads, and that errors in workers are properly surfaced.

See [[test-025]] for async testing fundamentals.
