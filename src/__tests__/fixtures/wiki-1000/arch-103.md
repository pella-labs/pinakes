# Scatter-Gather Pattern

## How It Works

A coordinator sends a request to multiple services in parallel, waits for responses, and aggregates the results.

## Use Cases

- **Search** — query multiple indexes, merge results by relevance
- **Price comparison** — query multiple suppliers, return lowest price
- **Health dashboard** — check all services, aggregate status

## Implementation

```typescript
async function scatterGather<T>(
  requests: (() => Promise<T>)[],
  timeoutMs: number = 5000,
): Promise<{ results: T[]; errors: Error[] }> {
  const settled = await Promise.allSettled(
    requests.map(fn =>
      Promise.race([
        fn(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Timeout')), timeoutMs)
        ),
      ])
    )
  );

  const results: T[] = [];
  const errors: Error[] = [];

  for (const result of settled) {
    if (result.status === 'fulfilled') results.push(result.value);
    else errors.push(result.reason);
  }

  return { results, errors };
}
```

## Partial Failure

Decide what to do when some requests fail:
- Return partial results with a warning
- Fail entirely if any request fails
- Require a quorum (majority must succeed)

See [[arch-001]], [[arch-014]].
