# Testing Memory Leaks

Memory leaks in long-running applications cause gradual performance degradation and eventual crashes.

## Detection Strategies

### Heap Snapshots

Take heap snapshots before and after an operation repeated many times:

```typescript
it('does not leak memory on repeated operations', async () => {
  if (typeof global.gc === 'function') global.gc();
  const before = process.memoryUsage().heapUsed;

  for (let i = 0; i < 10000; i++) {
    await processRequest(createTestRequest());
  }

  if (typeof global.gc === 'function') global.gc();
  const after = process.memoryUsage().heapUsed;

  // Allow some growth but not proportional to iterations
  const growth = after - before;
  expect(growth).toBeLessThan(10 * 1024 * 1024); // < 10MB
});
```

### Event Listener Leaks

The most common Node.js memory leak is forgetting to remove event listeners:

```typescript
it('removes listeners on cleanup', () => {
  const emitter = new EventEmitter();
  const handler = new RequestHandler(emitter);

  handler.start();
  const countBefore = emitter.listenerCount('data');

  handler.stop();
  const countAfter = emitter.listenerCount('data');

  expect(countAfter).toBeLessThan(countBefore);
});
```

## Common Leak Sources

- Closures capturing large objects
- Unbounded caches without eviction
- Event listeners not removed on cleanup
- Timers not cleared
- Global state accumulation

See [[test-017]] for soak testing that reveals leaks under sustained load.
