
# Testing Caching Layers

Caching introduces state that makes testing more complex. Tests must verify both the cached and uncached paths.

## Cache Behavior Tests

- **Cache miss**: First request hits the origin, populates cache
- **Cache hit**: Second request returns cached data without hitting origin
- **Cache invalidation**: After update, stale data is evicted
- **Cache expiry**: After TTL, data is re-fetched from origin

```typescript
describe('UserCache', () => {
  it('caches user on first fetch', async () => {
    const db = createMockDb();
    const cache = new UserCache(db);

    await cache.getUser(1); // miss
    await cache.getUser(1); // hit

    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it('invalidates on update', async () => {
    const db = createMockDb();
    const cache = new UserCache(db);

    await cache.getUser(1);
    await cache.updateUser(1, { name: 'New Name' });
    await cache.getUser(1);

    expect(db.query).toHaveBeenCalledTimes(2);
  });
});
```

## Testing with Real Redis

For integration tests, use a real Redis instance. **Testcontainers** can spin up Redis in Docker. Don't mock Redis in integration tests because its behavior (TTL handling, eviction policies) is what you're testing.

## Cache Stampede Testing

When many requests arrive simultaneously for expired data, they all hit the origin. Test that your cache handles this with request coalescing or a lock mechanism.
