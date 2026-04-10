# CPU Profiling and Flame Graphs

## What a Flame Graph Shows

A **flame graph** visualizes stack trace samples. The x-axis represents the proportion of samples (not time), and each box is a function call. Wide boxes are where the program spends the most time.

## Collecting Profiles in Node.js

```typescript
import { Session } from 'node:inspector/promises';

async function captureProfile(durationMs: number): Promise<void> {
  const session = new Session();
  session.connect();
  
  await session.post('Profiler.enable');
  await session.post('Profiler.start');
  
  await new Promise(resolve => setTimeout(resolve, durationMs));
  
  const { profile } = await session.post('Profiler.stop');
  writeFileSync('profile.cpuprofile', JSON.stringify(profile));
  session.disconnect();
}
```

## Reading Flame Graphs

Look for:

- **Plateaus**: wide flat areas indicate hot functions
- **Tall narrow stacks**: deep call chains that may indicate unnecessary abstraction
- **Recursive patterns**: repeated frames suggest recursion or tight loops

## Common Findings

When profiling Node.js applications, common surprises include:

- JSON.parse/stringify dominating CPU time
- Regular expression backtracking
- Synchronous file I/O on the event loop
- Template rendering (string concatenation)
- Excessive garbage collection pressure

## Continuous Profiling

Rather than profiling only during incidents, run **continuous profiling** at low overhead (1% CPU sampling) in production. Tools like Pyroscope and Parca aggregate profiles over time, making it possible to correlate performance changes with deployments.

See [[perf-027]] for memory profiling.
