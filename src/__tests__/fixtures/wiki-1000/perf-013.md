# Worker Pool Design

## Bounded Concurrency

A **worker pool** limits the number of concurrent tasks to prevent resource exhaustion. Without bounds, a burst of incoming work can spawn thousands of goroutines/promises/threads, each consuming memory and competing for CPU.

## Implementation in Node.js

```typescript
class WorkerPool {
  private running = 0;
  private queue: Array<() => Promise<void>> = [];

  constructor(private maxConcurrency: number) {}

  async submit<T>(task: () => Promise<T>): Promise<T> {
    if (this.running >= this.maxConcurrency) {
      await new Promise<void>(resolve => this.queue.push(resolve));
    }
    this.running++;
    try {
      return await task();
    } finally {
      this.running--;
      const next = this.queue.shift();
      if (next) next();
    }
  }
}

const pool = new WorkerPool(10);
await Promise.all(urls.map(url => pool.submit(() => fetch(url))));
```

## Sizing the Pool

- **CPU-bound work**: pool size = number of CPU cores
- **I/O-bound work**: pool size = cores * (1 + wait_time / compute_time)
- **Mixed**: profile and adjust empirically

## Backpressure

When the queue grows beyond a threshold, start rejecting new work or applying backpressure to the upstream producer. This prevents unbounded memory growth and cascading failures.

See [[perf-010]] for message queue patterns.
