# Event Loop Monitoring in Node.js

## Why It Matters

Node.js processes one event at a time on the event loop. If any callback takes too long, it blocks all other callbacks — including incoming HTTP requests. Monitoring event loop health is critical for Node.js performance.

## Event Loop Lag

Event loop lag measures how long a callback waits between being scheduled and being executed. High lag means the event loop is busy.

```typescript
import { monitorEventLoopDelay } from 'perf_hooks';

const histogram = monitorEventLoopDelay({ resolution: 20 });
histogram.enable();

setInterval(() => {
  const p99 = histogram.percentile(99) / 1e6; // convert ns to ms
  metrics.gauge('event_loop_delay_p99_ms', p99);
  histogram.reset();
}, 10000);
```

## Active Handles and Requests

Track open handles (timers, sockets, file watchers) and active requests (pending I/O):

```typescript
const handles = process._getActiveHandles().length;
const requests = process._getActiveRequests().length;
```

Growing handle count may indicate resource leaks.

## Blocking Detection

Use the `blocked-at` npm package in development to detect synchronous operations that block the event loop for more than a threshold:

```typescript
import blocked from 'blocked-at';

blocked((time, stack) => {
  logger.warn({ time, stack }, 'event loop blocked');
}, { threshold: 100 }); // log if blocked >100ms
```

## Common Blockers

- Synchronous file operations (`fs.readFileSync`)
- CPU-intensive computation (crypto, image processing)
- Large JSON parsing
- DNS lookups (use `dns.resolve` not `dns.lookup`)

See [[perf-058]] for profiling and [[perf-044]] for GC tuning.
