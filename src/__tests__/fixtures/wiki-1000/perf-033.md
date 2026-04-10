# Retry Strategies and Backoff

## When to Retry

Retry on **transient** failures only:
- Network timeouts
- 503 Service Unavailable
- 429 Too Many Requests (with Retry-After)
- Connection reset

Do not retry on:
- 400 Bad Request (your input is wrong)
- 401/403 (authentication/authorization)
- 404 (resource doesn't exist)
- 409 Conflict (requires application logic to resolve)

## Exponential Backoff with Jitter

```typescript
function getRetryDelay(attempt: number, baseMs: number = 1000): number {
  const exponential = baseMs * Math.pow(2, attempt);
  const jitter = Math.random() * exponential;
  return Math.min(exponential + jitter, 30000); // cap at 30s
}
```

Without jitter, all clients retry at the same time after an outage (**thundering herd**). Jitter spreads retries across time.

## Retry Budgets

Instead of per-request retry limits, use a **retry budget**: limit total retries to a percentage of total requests (e.g., 10%). This prevents retry storms during widespread failures.

## Idempotency

Retries are only safe for idempotent operations. For non-idempotent calls, use an **idempotency key** that the server uses to deduplicate.

See [[perf-031]] for circuit breakers and [[perf-030]] for rate limiting.
