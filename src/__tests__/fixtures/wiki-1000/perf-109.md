# Worker Threads in Node.js

## When to Use Worker Threads

Node.js worker threads run JavaScript in parallel on separate V8 isolates. Use them for CPU-intensive operations that would block the main event loop:

- Image processing
- Data compression
- Cryptographic operations
- Complex calculations
- Large JSON parsing

## Basic Usage

```typescript
import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';

if (isMainThread) {
  const worker = new Worker(__filename, { workerData: { input: largeArray } });
  worker.on('message', (result) => console.log('Result:', result));
  worker.on('error', (error) => console.error('Worker error:', error));
} else {
  const result = heavyComputation(workerData.input);
  parentPort!.postMessage(result);
}
```

## Worker Pool

Create a pool of persistent workers instead of spawning new ones per task:

```typescript
class WorkerThreadPool {
  private workers: Worker[] = [];
  private queue: Array<{ data: any; resolve: Function; reject: Function }> = [];
  private idle: Worker[] = [];

  constructor(workerPath: string, size: number) {
    for (let i = 0; i < size; i++) {
      const worker = new Worker(workerPath);
      this.idle.push(worker);
      this.workers.push(worker);
    }
  }
}
```

## Transferable Objects

For large ArrayBuffers, use `transfer` instead of copying:

```typescript
const buffer = new ArrayBuffer(1024 * 1024);
worker.postMessage(buffer, [buffer]); // zero-copy transfer
```

## Limitations

Workers don't share memory by default (use SharedArrayBuffer for that). Worker creation has overhead (~30ms). Communication overhead via structured clone.

See [[perf-013]] for worker pool design and [[perf-059]] for event loop monitoring.
