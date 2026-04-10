# Bulkhead Pattern

The **bulkhead pattern** isolates components so that a failure in one does not cascade to others. Named after the compartments in a ship's hull, bulkheads limit the blast radius of failures.

## Types of Isolation

### Thread Pool Bulkheads

Assign separate thread pools (or connection pools) to different downstream dependencies. If the payment service is slow and exhausts its pool, the inventory service calls still have their own pool and continue working.

### Process Bulkheads

Run critical workloads in separate processes or containers. A CPU-intensive report generator shouldn't compete with the request-handling path.

### Infrastructure Bulkheads

Separate failure domains at the infrastructure level. Use different database clusters for different service groups. Deploy critical services in multiple availability zones.

## Implementation Example

```typescript
class BulkheadExecutor {
  private active = 0;
  private queue: Array<{
    resolve: (v: unknown) => void;
    reject: (e: Error) => void;
    fn: () => Promise<unknown>;
  }> = [];

  constructor(
    private readonly maxConcurrent: number = 10,
    private readonly maxQueue: number = 50,
  ) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.maxConcurrent) {
      if (this.queue.length >= this.maxQueue) {
        throw new BulkheadFullError();
      }
      return new Promise((resolve, reject) => {
        this.queue.push({ resolve, reject, fn });
      }) as Promise<T>;
    }

    return this.run(fn);
  }

  private async run<T>(fn: () => Promise<T>): Promise<T> {
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.dequeue();
    }
  }

  private dequeue(): void {
    const next = this.queue.shift();
    if (next) {
      this.run(next.fn).then(next.resolve).catch(next.reject);
    }
  }
}
```

## Combining with Circuit Breakers

Bulkheads and [[circuit-breakers]] complement each other. The bulkhead limits resource consumption. The circuit breaker detects sustained failures and stops making calls. Together they provide both resource isolation and fast failure detection.

See also [[monitoring-setup]] for alerting on bulkhead saturation.
