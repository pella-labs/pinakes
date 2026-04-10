# Testing Worker Threads

Node.js **worker threads** enable CPU-intensive work without blocking the event loop. Testing them requires handling message passing and lifecycle.

## Message Passing

```typescript
it('processes data in worker thread', async () => {
  const worker = new Worker('./heavy-computation.js');
  const resultPromise = new Promise(resolve => {
    worker.on('message', resolve);
  });

  worker.postMessage({ data: [1, 2, 3, 4, 5] });
  const result = await resultPromise;

  expect(result).toEqual({ sum: 15, average: 3 });
  await worker.terminate();
});
```

## Error Handling

```typescript
it('handles worker errors', async () => {
  const worker = new Worker('./buggy-worker.js');
  const errorPromise = new Promise(resolve => {
    worker.on('error', resolve);
  });

  worker.postMessage({ invalid: true });
  const error = await errorPromise;
  expect(error.message).toContain('Invalid input');
});
```

## Worker Pool

Test that a worker pool distributes work across workers and handles worker crashes:

```typescript
it('redistributes work on worker crash', async () => {
  const pool = new WorkerPool(4);
  const tasks = Array.from({ length: 10 }, (_, i) => ({ id: i }));

  // Kill one worker mid-execution
  setTimeout(() => pool.workers[0].terminate(), 50);

  const results = await pool.runAll(tasks);
  expect(results).toHaveLength(10); // all tasks completed despite crash
});
```

See [[test-039]] for concurrency testing patterns.
