# Testing Error Recovery

Systems that recover gracefully from failures are more reliable than systems that try to prevent all failures.

## Circuit Breaker Testing

```typescript
describe('CircuitBreaker', () => {
  it('opens after threshold failures', async () => {
    const breaker = new CircuitBreaker({ threshold: 3 });
    const failingFn = vi.fn().mockRejectedValue(new Error('fail'));

    for (let i = 0; i < 3; i++) {
      await breaker.call(failingFn).catch(() => {});
    }

    expect(breaker.state).toBe('open');
    await expect(breaker.call(failingFn)).rejects.toThrow('Circuit is open');
    expect(failingFn).toHaveBeenCalledTimes(3); // not called when open
  });

  it('half-opens after timeout', async () => {
    const breaker = new CircuitBreaker({ threshold: 3, resetTimeout: 1000 });
    // ... trip the breaker

    vi.advanceTimersByTime(1000);
    expect(breaker.state).toBe('half-open');
  });
});
```

## Retry with Backoff

Test that exponential backoff increases the delay between retries:

```typescript
it('uses exponential backoff', async () => {
  const delays: number[] = [];
  const mockSleep = async (ms: number) => { delays.push(ms); };

  await retryWithBackoff(failingFn, { maxRetries: 4, sleep: mockSleep });

  expect(delays).toEqual([100, 200, 400, 800]);
});
```

## Graceful Degradation

Test that the system provides reduced functionality rather than complete failure when dependencies are unavailable.
