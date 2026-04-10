---
title: Distributed Locks
tags: [distributed-systems, redis, locking]
---
# Distributed Locks

## Why Distributed Locks

In a distributed system, multiple processes need to coordinate access to shared resources. A **distributed lock** ensures only one process operates on a resource at a time.

## Redlock Algorithm

Martin Kleppmann and others debate Redlock's correctness, but it's widely used in practice:

1. Get current time
2. Try to acquire lock on N/2+1 Redis instances
3. Calculate elapsed time; if lock acquired on majority within TTL, success
4. If failed, release lock on all instances

## Simpler Alternative: Single Redis Lock

For most applications, a single Redis instance lock is sufficient:

```typescript
async function acquireLock(key: string, ttlMs: number): Promise<string | null> {
  const token = crypto.randomUUID();
  const acquired = await redis.set(
    `lock:${key}`, token, 'PX', ttlMs, 'NX'
  );
  return acquired ? token : null;
}

async function releaseLock(key: string, token: string): Promise<boolean> {
  const script = `
    if redis.call('GET', KEYS[1]) == ARGV[1] then
      return redis.call('DEL', KEYS[1])
    end
    return 0
  `;
  const result = await redis.eval(script, 1, `lock:${key}`, token);
  return result === 1;
}
```

## Lock Safety Properties

- **Mutual exclusion**: at most one client holds the lock
- **Deadlock freedom**: even if a client crashes, the lock eventually releases (TTL)
- **Fault tolerance**: lock works as long as majority of Redis nodes are up

## Fencing Tokens

Use monotonically increasing **fencing tokens** to prevent stale lock holders from performing operations after their lock expired.

See [[perf-002]] for Redis and [[perf-088]] for database locks.
