# Bulkhead Pattern

## Isolation for Resilience

The **bulkhead pattern** partitions resources into isolated pools so that a failure in one area doesn't exhaust resources for others. Named after ship bulkheads that contain flooding.

## Thread Pool Bulkheads

Assign separate thread/connection pools for different downstream services:

- Payment service: dedicated pool of 10 connections
- Inventory service: dedicated pool of 10 connections  
- Notification service: dedicated pool of 5 connections

If the payment service becomes slow and exhausts its pool, inventory and notification calls continue unaffected.

## Semaphore Bulkheads

Lighter weight than thread pools. Use a counting semaphore to limit concurrent calls to each downstream:

```typescript
class Bulkhead {
  private permits: number;
  private waiting: Array<() => void> = [];

  constructor(private maxConcurrent: number) {
    this.permits = maxConcurrent;
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return Promise.resolve();
    }
    return new Promise(resolve => this.waiting.push(resolve));
  }

  private release(): void {
    const next = this.waiting.shift();
    if (next) next();
    else this.permits++;
  }
}
```

## Combined with Circuit Breakers

Bulkheads and circuit breakers complement each other. The bulkhead limits blast radius; the circuit breaker stops wasting resources on a known-bad downstream.

See [[perf-031]] for circuit breakers and [[perf-013]] for worker pools.
