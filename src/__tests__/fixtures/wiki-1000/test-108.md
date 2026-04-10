# Testing Atomic Operations

Atomic operations ensure data consistency without explicit locking. Testing them requires concurrent execution.

## Compare-and-Swap

```typescript
it('atomically updates value', async () => {
  const atom = new AtomicValue(0);

  await Promise.all(
    Array.from({ length: 100 }, async () => {
      let success = false;
      while (!success) {
        const current = atom.get();
        success = atom.compareAndSwap(current, current + 1);
      }
    })
  );

  expect(atom.get()).toBe(100);
});
```

## Atomic File Writes

```typescript
it('atomic write is not partially visible', async () => {
  const path = join(tempDir, 'data.json');
  await writeFileSync(path, 'original content');

  // Start an atomic write
  const writePromise = atomicWrite(path, 'new content');

  // Read during write should see either old or new, never partial
  const content = readFileSync(path, 'utf-8');
  expect(['original content', 'new content']).toContain(content);

  await writePromise;
  expect(readFileSync(path, 'utf-8')).toBe('new content');
});
```

## Database Atomic Counters

```typescript
it('increments counter atomically', async () => {
  await db.query('INSERT INTO counters (name, value) VALUES ($1, 0)', ['hits']);

  await Promise.all(
    Array.from({ length: 100 }, () =>
      db.query('UPDATE counters SET value = value + 1 WHERE name = $1', ['hits'])
    )
  );

  const result = await db.query('SELECT value FROM counters WHERE name = $1', ['hits']);
  expect(result.rows[0].value).toBe(100);
});
```

See [[test-039]] for broader concurrency testing and [[test-063]] for transaction testing.
