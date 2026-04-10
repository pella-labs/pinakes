# Cron Job Performance

## Overlap Prevention

If a cron job takes longer than its schedule interval, multiple instances run concurrently, competing for resources. Prevent this with a lock:

```typescript
async function runWithLock(name: string, fn: () => Promise<void>): Promise<void> {
  const acquired = await redis.set(`lock:${name}`, '1', 'EX', 3600, 'NX');
  if (!acquired) {
    logger.info({ job: name }, 'skipped: already running');
    return;
  }
  try {
    await fn();
  } finally {
    await redis.del(`lock:${name}`);
  }
}
```

## Staggering

When multiple cron jobs run on the same schedule, stagger their start times to avoid resource contention peaks.

## Monitoring

Track for every cron job:
- Last successful run timestamp
- Duration
- Success/failure count
- Items processed

Alert when a cron job hasn't run successfully within its expected interval.

## Idempotency

Cron jobs should be idempotent. If a job is re-run (due to failure recovery or accidental double-execution), it should produce the same result without side effects.

See [[perf-084]] for batch processing.
