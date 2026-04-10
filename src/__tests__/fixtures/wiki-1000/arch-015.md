# Retry and Backoff Strategies

## Naive Retry Is Dangerous

Retrying failed requests without backoff can create a **thundering herd** that overwhelms a recovering service.

## Exponential Backoff with Jitter

```typescript
function backoffWithJitter(attempt: number, baseMs: number = 100): number {
  const exponential = baseMs * Math.pow(2, attempt);
  const jitter = Math.random() * exponential;
  return Math.min(exponential + jitter, 30000); // cap at 30s
}
```

## Retry Budget

Instead of per-request retry limits, use a **retry budget**: allow retries only if they constitute less than X% of total requests in a window.

```
if (retries_in_window / total_requests_in_window < 0.1) {
  // allow retry
} else {
  // fail fast — too many retries already
}
```

## Idempotency

Retries are only safe if the operation is **idempotent**. For non-idempotent operations, use an idempotency key.

See [[arch-014]], [[api-rest-design]].
