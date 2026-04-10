
# Testing Connection Pooling

Connection pools manage scarce resources. Testing them ensures proper allocation, reuse, and cleanup.

## Pool Sizing

```typescript
it('does not exceed max pool size', async () => {
  const pool = createPool({ min: 2, max: 5 });

  // Acquire all connections
  const connections = await Promise.all(
    Array.from({ length: 5 }, () => pool.acquire())
  );

  expect(connections).toHaveLength(5);

  // Next acquire should wait
  const acquirePromise = pool.acquire();
  const timedOut = await Promise.race([
    acquirePromise.then(() => false),
    sleep(100).then(() => true),
  ]);
  expect(timedOut).toBe(true);

  // Release one and the waiter should get it
  await pool.release(connections[0]);
  const nextConn = await acquirePromise;
  expect(nextConn).toBeDefined();
});
```

## Connection Validation

Test that the pool validates connections before handing them out. A connection that was closed by the server should be replaced.

## Idle Timeout

Connections idle for too long should be closed. Test that the pool shrinks back to the minimum size after a period of inactivity.

## Error Handling

Test pool behavior when connection creation fails. The pool should retry, not exhaust its capacity with failed connections.

See [[test-088]] for resource cleanup patterns.
