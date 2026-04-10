# Testing Large Dataset Handling

Applications must handle large datasets without running out of memory or becoming unresponsive.

## Streaming Processing

```typescript
it('processes 1M records without excessive memory', async () => {
  const baselineMemory = process.memoryUsage().heapUsed;

  let count = 0;
  for await (const record of streamRecords('large-dataset.jsonl')) {
    processRecord(record);
    count++;
  }

  expect(count).toBe(1_000_000);
  const memoryGrowth = process.memoryUsage().heapUsed - baselineMemory;
  expect(memoryGrowth).toBeLessThan(100 * 1024 * 1024); // < 100MB
});
```

## Pagination Under Load

```typescript
it('paginates consistently with 100K records', async () => {
  await seedRecords(100_000);

  const allIds = new Set<string>();
  let cursor = null;

  do {
    const page = await fetchPage({ cursor, limit: 1000 });
    page.items.forEach(item => allIds.add(item.id));
    cursor = page.nextCursor;
  } while (cursor);

  expect(allIds.size).toBe(100_000); // no duplicates, no gaps
});
```

## Query Performance

```typescript
it('searches 100K records in under 200ms', async () => {
  await seedRecords(100_000);

  const start = Date.now();
  const results = await search('test query');
  const duration = Date.now() - start;

  expect(duration).toBeLessThan(200);
  expect(results.length).toBeGreaterThan(0);
});
```

## Graceful Degradation

Test that the system degrades gracefully when data volume exceeds expectations. Return partial results with a warning rather than timing out.

See [[test-017]] for load testing and [[test-023]] for performance benchmarks.
