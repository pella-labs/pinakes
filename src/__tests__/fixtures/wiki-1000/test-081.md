# Testing Cron Jobs and Scheduled Tasks

Scheduled tasks run unattended. When they fail, nobody notices until the consequences appear.

## Testing the Schedule Expression

```typescript
import { parseExpression } from 'cron-parser';

it('runs daily at 3 AM UTC', () => {
  const expr = parseExpression('0 3 * * *');
  const next = expr.next().toDate();
  expect(next.getUTCHours()).toBe(3);
  expect(next.getUTCMinutes()).toBe(0);
});
```

## Testing the Job Logic

Separate the scheduling from the logic. Test the logic as a regular function:

```typescript
it('cleans up expired sessions', async () => {
  await createExpiredSessions(10);
  await createActiveSessions(5);

  await cleanupExpiredSessions();

  expect(await countSessions()).toBe(5);
});
```

## Overlap Prevention

If a job runs longer than its schedule interval, test that overlapping executions are prevented:

```typescript
it('skips if previous run is still active', async () => {
  let concurrentRuns = 0;
  let maxConcurrent = 0;

  const job = async () => {
    concurrentRuns++;
    maxConcurrent = Math.max(maxConcurrent, concurrentRuns);
    await sleep(100);
    concurrentRuns--;
  };

  await Promise.all([runJob(job), runJob(job), runJob(job)]);
  expect(maxConcurrent).toBe(1);
});
```

## Failure Notification

Test that failed scheduled tasks trigger alerts. A silent failure in a nightly job can corrupt data for days before anyone notices.
