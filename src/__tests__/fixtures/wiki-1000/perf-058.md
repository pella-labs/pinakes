# Profiling Node.js Applications

## Built-in Profiler

Node.js includes V8's sampling profiler:

```bash
# Record a profile
node --prof app.js

# Process the profile into readable format
node --prof-process isolate-*.log > profile.txt
```

## Inspector Protocol

For more control, use the inspector protocol programmatically:

```typescript
import { Session } from 'node:inspector/promises';

const session = new Session();
session.connect();

await session.post('Profiler.enable');
await session.post('Profiler.start');

// ... run workload ...

const { profile } = await session.post('Profiler.stop');
// profile is a CPUProfile object compatible with Chrome DevTools
```

## Heap Profiling

Track allocations over time to find memory-hungry code paths:

```bash
node --heap-prof app.js
# Produces a .heapprofile file viewable in Chrome DevTools
```

## Common Bottlenecks Found by Profiling

- Synchronous JSON serialization of large objects
- Regular expression backtracking
- Excessive string concatenation
- Unintentional synchronous I/O
- Repeated computation that could be memoized

## Production Profiling

Use **continuous profiling** services (Pyroscope, Google Cloud Profiler) that sample at low overhead (~1% CPU) and aggregate over time. This captures performance characteristics under real traffic patterns.

See [[perf-026]] for flame graphs and [[perf-027]] for memory leaks.
