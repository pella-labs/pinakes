
# Testing Rate Limiting

Rate limiting protects services from abuse. Testing it requires precise timing and careful assertion of behavior at boundaries.

## Basic Rate Limit Tests

```typescript
describe('rate limiter', () => {
  it('allows requests within limit', async () => {
    for (let i = 0; i < 10; i++) {
      const res = await api.get('/endpoint');
      expect(res.status).toBe(200);
    }
  });

  it('blocks requests exceeding limit', async () => {
    // Exhaust the limit
    for (let i = 0; i < 10; i++) {
      await api.get('/endpoint');
    }

    // Next request should be blocked
    const res = await api.get('/endpoint');
    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBeDefined();
  });
});
```

## Testing Window Reset

After the rate limit window expires, requests should be allowed again. Use fake timers to advance time without waiting:

```typescript
it('resets after window expires', async () => {
  // Exhaust limit
  for (let i = 0; i < 10; i++) await api.get('/endpoint');

  vi.advanceTimersByTime(60_000); // advance 1 minute

  const res = await api.get('/endpoint');
  expect(res.status).toBe(200);
});
```

## Per-User vs Global Limits

Test that rate limits are scoped correctly. User A exceeding their limit should not affect User B.

## Distributed Rate Limiting

When rate limits are shared across multiple server instances (via Redis), test that the limit is enforced globally, not per-instance.
