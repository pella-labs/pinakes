---
source: extracted
---
# Caching Strategies

## Cache-Aside (Lazy Loading)

Application checks cache first. On miss, loads from DB, stores in cache.

```typescript
async function getUser(id: string): Promise<User> {
  let user = await cache.get(`user:${id}`);
  if (!user) {
    user = await db.query('SELECT * FROM users WHERE id = ?', [id]);
    await cache.set(`user:${id}`, user, TTL_SECONDS);
  }
  return user;
}
```

## Write-Through

Every write goes to both cache and DB simultaneously.

## Write-Behind (Write-Back)

Write to cache immediately, async flush to DB. Faster writes, risk of data loss.

## Read-Through

Cache sits in front of DB. Cache itself fetches on miss (no app logic needed).

## Invalidation

The two hard things in computer science: cache invalidation and naming things.

Options:
- **TTL** — expire after N seconds (simple, allows staleness)
- **Event-driven** — invalidate on write events
- **Version tags** — cache key includes version, bump on change

See [[perf-caching]], [[arch-045]], [[arch-040]].
