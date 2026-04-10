# Testing Asynchronous Code

Asynchronous code is harder to test because the execution order is non-deterministic. Proper handling of promises, timers, and event emitters is critical.

## Promises and Async/Await

Always return or await promises in tests:

```typescript
// Wrong: test passes even if promise rejects
it('loads data', () => {
  fetchData(); // floating promise
});

// Correct: test waits for the promise
it('loads data', async () => {
  const data = await fetchData();
  expect(data).toBeDefined();
});
```

## Fake Timers

Use fake timers for code that depends on `setTimeout` or `setInterval`:

```typescript
beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

it('retries after delay', async () => {
  const promise = retryWithBackoff(failingFn);
  vi.advanceTimersByTime(1000);
  await promise;
});
```

## Event Emitters

Test events by subscribing and asserting:

```typescript
it('emits done event', () => {
  return new Promise<void>((resolve) => {
    processor.on('done', (result) => {
      expect(result.count).toBe(5);
      resolve();
    });
    processor.start();
  });
});
```

## Testing Race Conditions

Race conditions are the hardest async bugs to test. Use deterministic scheduling or property-based testing with concurrent scenarios. See [[test-013]] for property-based testing.
