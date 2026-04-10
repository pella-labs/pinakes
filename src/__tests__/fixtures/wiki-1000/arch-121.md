---
source: extracted
confidence: ambiguous
---
# Concurrency Patterns

## Mutex / Lock

Only one thread/coroutine accesses a resource at a time. Simple but can deadlock.

## Read-Write Lock

Multiple concurrent readers, exclusive writer. Good for read-heavy workloads.

## Actor Model

Each actor has private state and a mailbox. Actors communicate only via messages. No shared mutable state.

## CSP (Communicating Sequential Processes)

Goroutines + channels in Go. Processes communicate via typed channels, not shared memory.

## Async/Await

Cooperative concurrency. A single thread switches between tasks at await points. No parallelism, but no data races either.

## Node.js Concurrency Model

Event loop + async I/O. Single-threaded for JavaScript execution, multi-threaded for I/O (libuv thread pool). Worker threads for CPU-bound tasks.

```typescript
import { Worker } from 'worker_threads';

const worker = new Worker('./heavy-computation.js', {
  workerData: { input: largeDataset }
});

worker.on('message', (result) => {
  console.log('Computed:', result);
});
```

See [[arch-120]], [[perf-caching]].
