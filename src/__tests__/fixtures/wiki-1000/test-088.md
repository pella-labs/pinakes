# Testing Resource Cleanup

Resource leaks cause gradual degradation. Test that resources are properly cleaned up after use.

## File Handle Cleanup

```typescript
it('closes file handles after reading', async () => {
  const openBefore = countOpenFileDescriptors();

  for (let i = 0; i < 100; i++) {
    await readAndProcess(`test-${i}.txt`);
  }

  const openAfter = countOpenFileDescriptors();
  expect(openAfter - openBefore).toBeLessThanOrEqual(5); // small margin
});
```

## Database Connection Cleanup

```typescript
it('returns connections to pool', async () => {
  const pool = createPool({ max: 5 });

  for (let i = 0; i < 20; i++) {
    const conn = await pool.acquire();
    await conn.query('SELECT 1');
    await pool.release(conn);
  }

  expect(pool.available).toBe(5);
  expect(pool.pending).toBe(0);
});
```

## Cleanup on Error

```typescript
it('releases resources even when operation fails', async () => {
  const resource = await acquire();

  try {
    await failingOperation(resource);
  } catch (e) {
    // expected
  }

  expect(resource.isReleased).toBe(true);
});
```

## Using `finally` Blocks

Test that cleanup code runs regardless of success or failure. The `using` keyword in newer TypeScript versions makes this pattern first-class.

See [[test-049]] for memory leak testing.
