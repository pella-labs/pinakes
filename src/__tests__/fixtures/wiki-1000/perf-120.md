# Request Queuing and Priority

## Queue Theory Basics

**Little's Law**: L = λW (average queue length = arrival rate * average wait time). When the service rate drops below the arrival rate, the queue grows without bound.

## Priority Queues

Not all requests are equal. Assign priorities and process higher-priority requests first:

```typescript
class PriorityRequestQueue {
  private queues: Map<number, Request[]> = new Map([
    [0, []], // critical
    [1, []], // high
    [2, []], // normal
    [3, []], // low
  ]);

  enqueue(request: Request, priority: number): void {
    this.queues.get(priority)!.push(request);
  }

  dequeue(): Request | undefined {
    for (const [, queue] of this.queues) {
      if (queue.length > 0) return queue.shift();
    }
    return undefined;
  }
}
```

## Weighted Fair Queuing

Instead of strict priority (which can starve low-priority requests), use weighted fair queuing. Each priority level gets a proportion of capacity.

## Admission Control

When the queue reaches a threshold, reject new requests rather than letting queue wait times grow unbounded. Return 503 with a Retry-After header.

## Load Shedding

Under extreme load, drop low-priority requests entirely to preserve capacity for critical operations. This is a deliberate tradeoff: some users get errors so that the most important operations continue to work.

See [[perf-030]] for rate limiting and [[perf-035]] for graceful degradation.
