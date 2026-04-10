---
title: Testing Cache Invalidation
tags: [testing, caching, consistency]
created: 2025-10-05
---

# Testing Cache Invalidation

Cache invalidation is one of the two hard problems in computer science. Testing it requires verifying consistency between cache and source.

## Write-Through Invalidation

```typescript
it('invalidates cache on write', async () => {
  // Populate cache
  const cached = await cache.get('user:1');
  expect(cached.name).toBe('Alice');

  // Update source
  await db.update('users', { name: 'Alicia' }, { id: 1 });
  await cache.invalidate('user:1');

  // Cache should return updated data
  const fresh = await cache.get('user:1');
  expect(fresh.name).toBe('Alicia');
});
```

## Pattern-Based Invalidation

```typescript
it('invalidates by pattern', async () => {
  await cache.set('user:1:profile', data1);
  await cache.set('user:1:settings', data2);
  await cache.set('user:2:profile', data3);

  await cache.invalidatePattern('user:1:*');

  expect(await cache.has('user:1:profile')).toBe(false);
  expect(await cache.has('user:1:settings')).toBe(false);
  expect(await cache.has('user:2:profile')).toBe(true);
});
```

## Race Conditions

Test the scenario where a read populates the cache just after a write invalidates it. This is the classic stale-cache race condition.

## Tag-Based Invalidation

If your cache supports tags, test that invalidating a tag clears all entries with that tag without affecting untagged entries.

See [[test-037]] for general caching layer tests.
