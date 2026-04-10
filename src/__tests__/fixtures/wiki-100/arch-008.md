# Circuit Breaker Pattern

The **circuit breaker** prevents cascading failures in distributed systems by failing fast when a downstream service is unhealthy. Named after electrical circuit breakers, it has three states.

## States

### Closed (Normal)

Requests flow through normally. The breaker tracks failure rates. If failures exceed a threshold (e.g., 50% of the last 20 requests), the breaker **trips open**.

### Open (Failing Fast)

All requests immediately return an error or fallback response without calling the downstream service. This gives the failing service time to recover. After a configured timeout (e.g., 30 seconds), the breaker moves to half-open.

### Half-Open (Probing)

A limited number of requests are allowed through. If they succeed, the breaker closes. If they fail, it opens again.

```typescript
class CircuitBreaker {
  private state: 'closed' | 'open' | 'half-open' = 'closed';
  private failures = 0;
  private lastFailureTime = 0;

  constructor(
    private readonly threshold: number = 5,
    private readonly resetTimeout: number = 30_000,
  ) {}

  async call<T>(fn: () => Promise<T>, fallback?: () => T): Promise<T> {
    if (this.state === 'open') {
      if (Date.now() - this.lastFailureTime > this.resetTimeout) {
        this.state = 'half-open';
      } else {
        if (fallback) return fallback();
        throw new CircuitOpenError();
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  private onSuccess(): void {
    this.failures = 0;
    this.state = 'closed';
  }

  private onFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();
    if (this.failures >= this.threshold) {
      this.state = 'open';
    }
  }
}
```

## Integration Points

Circuit breakers are typically applied at service-to-service call boundaries. In a [[arch-006]] service mesh, they can be configured declaratively. In application code, libraries like `opossum` (Node.js) or Resilience4j (Java) provide battle-tested implementations.

See also [[monitoring-setup]] for alerting on breaker state transitions.
