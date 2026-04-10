# Async Patterns in TypeScript

## Promise.all vs Promise.allSettled

```typescript
// Promise.all: fails fast, rejects on first error
const results = await Promise.all([fetchA(), fetchB(), fetchC()]);

// Promise.allSettled: waits for all, never rejects
const results = await Promise.allSettled([fetchA(), fetchB(), fetchC()]);
for (const result of results) {
  if (result.status === 'fulfilled') handleSuccess(result.value);
  else handleError(result.reason);
}
```

Use `Promise.all` when all results are needed. Use `Promise.allSettled` when partial results are acceptable.

## Promise.race for Timeouts

```typescript
async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms)
  );
  return Promise.race([promise, timeout]);
}
```

## AsyncIterator for Streaming

```typescript
async function* fetchPages(url: string): AsyncGenerator<Page> {
  let cursor: string | null = null;
  do {
    const response = await fetch(`${url}?cursor=${cursor || ''}`);
    const data = await response.json();
    yield* data.items;
    cursor = data.nextCursor;
  } while (cursor);
}

for await (const page of fetchPages('/api/pages')) {
  await processPage(page);
}
```

## AbortController for Cancellation

Use `AbortController` to cancel in-flight requests when they're no longer needed (user navigated away, newer request supersedes).

See [[perf-083]] for async I/O in Node.js.
