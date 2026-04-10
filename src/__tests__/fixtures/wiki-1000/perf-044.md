---
title: Garbage Collection Tuning
tags: [gc, memory, performance, jvm]
---
# Garbage Collection Tuning

## Node.js V8 GC

V8 uses a **generational garbage collector** with two main spaces:

- **Young generation** (new space): small, collected frequently (Scavenge)
- **Old generation** (old space): large, collected infrequently (Mark-Sweep/Mark-Compact)

## Key Flags

```bash
# Increase old space size (default ~1.5GB)
node --max-old-space-size=4096 app.js

# Expose GC metrics
node --expose-gc app.js

# Trace GC events
node --trace-gc app.js
```

## GC Pauses

Mark-Sweep pauses can reach 100ms+ for large heaps. V8 mitigates this with:

- **Incremental marking**: spread marking across multiple small steps
- **Concurrent marking**: mark on background threads
- **Parallel scavenge**: young gen collection on multiple threads

## Monitoring GC

```typescript
const { PerformanceObserver } = require('perf_hooks');

const obs = new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) {
    if (entry.entryType === 'gc') {
      metrics.histogram('gc_pause_ms', entry.duration, { kind: entry.detail.kind });
    }
  }
});
obs.observe({ entryTypes: ['gc'] });
```

## Allocation Pressure

Reduce GC pressure by minimizing short-lived allocations:

- Reuse objects and arrays where possible
- Avoid creating closures in hot loops
- Use TypedArrays for binary data instead of regular arrays
- Pool frequently allocated objects

See [[perf-027]] for memory leak detection.
