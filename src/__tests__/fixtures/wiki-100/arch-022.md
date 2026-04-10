---
source: ai-generated
---

# Rate Limiting Patterns

**Rate limiting** controls the rate of requests a client can make to a service. It protects backend services from abuse, ensures fair resource allocation, and prevents cascading failures.

## Algorithms

### Token Bucket

A bucket holds tokens. Each request consumes one token. Tokens are added at a fixed rate. If the bucket is empty, the request is rejected. Allows bursts up to the bucket capacity.

### Sliding Window Log

Track timestamps of all requests in a window. Count them. If over the limit, reject. Precise but memory-intensive for high-traffic services.

### Sliding Window Counter

Combine fixed window counters with interpolation. Less precise than the log approach but much more memory-efficient. This is what most production rate limiters use.

```typescript
class SlidingWindowCounter {
  private previousCount = 0;
  private currentCount = 0;
  private windowStart: number;

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {
    this.windowStart = Date.now();
  }

  allow(): boolean {
    const now = Date.now();
    const elapsed = now - this.windowStart;

    if (elapsed >= this.windowMs) {
      this.previousCount = this.currentCount;
      this.currentCount = 0;
      this.windowStart = now;
    }

    const weight = 1 - elapsed / this.windowMs;
    const estimatedCount =
      this.previousCount * weight + this.currentCount;

    if (estimatedCount >= this.limit) {
      return false;
    }

    this.currentCount++;
    return true;
  }
}
```

## Where to Apply

- **API gateway** ([[arch-007]]): first line of defense, per-client limits
- **Service level**: per-endpoint or per-tenant limits
- **Database level**: connection pool limits act as implicit rate limiters

## Response Headers

Always communicate rate limit state to clients via headers:

- `X-RateLimit-Limit`: maximum requests per window
- `X-RateLimit-Remaining`: requests remaining in current window
- `X-RateLimit-Reset`: UTC epoch time when the window resets
- `Retry-After`: seconds to wait before retrying (on 429 responses)

See [[api-design]] for rate limiting as part of API contract design.
