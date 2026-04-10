# Testing Retry Mechanisms

Retry logic handles transient failures. Testing it requires simulating failure patterns and verifying the retry behavior.

## Fixed Retry Count

```typescript
it('retries exactly 3 times', async () => {
  let attempts = 0;
  const fn = vi.fn(async () => {
    attempts++;
    throw new Error('fail');
  });

  await expect(retry(fn, { maxRetries: 3 })).rejects.toThrow('fail');
  expect(attempts).toBe(4); // 1 initial + 3 retries
});
```

## Exponential Backoff

```typescript
it('increases delay exponentially', async () => {
  const delays: number[] = [];
  const mockSleep = vi.fn(async (ms: number) => delays.push(ms));

  const alwaysFails = async () => { throw new Error('fail'); };
  await retry(alwaysFails, {
    maxRetries: 4,
    baseDelay: 100,
    sleep: mockSleep,
  }).catch(() => {});

  expect(delays).toEqual([100, 200, 400, 800]);
});
```

## Jitter

Test that retry delays include jitter to prevent thundering herd:

```typescript
it('adds jitter to delays', async () => {
  const delays = await collectRetryDelays(100);
  // All delays should be different due to jitter
  const unique = new Set(delays);
  expect(unique.size).toBe(delays.length);
  // But within expected range
  delays.forEach(d => {
    expect(d).toBeGreaterThanOrEqual(50);
    expect(d).toBeLessThanOrEqual(150);
  });
});
```

## Non-Retryable Errors

Some errors should not be retried (4xx client errors, validation failures):

```typescript
it('does not retry 400 errors', async () => {
  const fn = vi.fn().mockRejectedValue(new HttpError(400));
  await expect(retry(fn, { maxRetries: 3 })).rejects.toThrow();
  expect(fn).toHaveBeenCalledTimes(1);
});
```
