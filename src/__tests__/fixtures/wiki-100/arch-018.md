# Retry and Backoff Strategies

Transient failures are inevitable in distributed systems. **Retry strategies** define how and when to re-attempt failed operations. The wrong strategy turns a minor blip into a cascading outage.

## Retry Policies

### Fixed Interval

Retry every N milliseconds. Simple but dangerous — if the downstream is overwhelmed, fixed retries pile on load at a constant rate.

### Exponential Backoff

Double the wait time between retries. 100ms, 200ms, 400ms, 800ms. This gives the downstream service breathing room to recover.

### Exponential Backoff with Jitter

Add randomness to the backoff interval to prevent **thundering herd** scenarios where many clients retry at exactly the same time.

```typescript
function calculateBackoff(
  attempt: number,
  baseMs: number = 100,
  maxMs: number = 30_000,
): number {
  const exponential = baseMs * Math.pow(2, attempt);
  const capped = Math.min(exponential, maxMs);
  const jitter = Math.random() * capped;
  return Math.floor(jitter);
}
```

## Retry Budgets

Instead of limiting retries per request, set a **retry budget** as a percentage of total traffic. "Retry at most 10% of the request rate." This prevents retries from dominating traffic during widespread failures.

## What to Retry

Not all failures are retryable:

- **Retryable**: 503 Service Unavailable, 429 Too Many Requests, connection timeouts, DNS resolution failures
- **Not retryable**: 400 Bad Request, 401 Unauthorized, 404 Not Found, 409 Conflict

## Combining Patterns

Use retries inside a [[circuit-breakers]] circuit breaker. The circuit breaker stops retries entirely when the downstream is confirmed unhealthy. Add a [[arch-015]] bulkhead to limit how many concurrent retry attempts can be in-flight.

See [[api-design]] for how to communicate retry guidance via `Retry-After` headers.
