---
title: Performance Benchmarks
tags: [testing, performance, benchmarks]
---

# Performance Benchmarks

**Performance benchmarks** establish baseline measurements for critical operations. They detect performance regressions before they reach production.

## Microbenchmarks

Test individual function performance:

```typescript
import { bench, describe } from 'vitest';

describe('string operations', () => {
  bench('split and join', () => {
    'hello-world-foo-bar'.split('-').join('_');
  });

  bench('replace with regex', () => {
    'hello-world-foo-bar'.replace(/-/g, '_');
  });
});
```

## Macrobenchmarks

Test system-level operations: API response times, database query durations, page load times. These matter more than microbenchmarks for user experience.

## Continuous Benchmarking

Run benchmarks in CI and compare against historical data. Flag regressions that exceed a threshold (e.g., 10% slower than the rolling average).

Tools:
- **codspeed** — GitHub Actions benchmark tracking
- **Bencher** — continuous benchmarking platform
- **k6** — for HTTP endpoint benchmarks (see [[test-017]])

## Statistical Rigor

A single benchmark run is noisy. Run at least 100 iterations and report p50, p95, and p99. Use statistical tests to determine if a change is significant or just noise.

## Avoiding Benchmark Pitfalls

- Warm up the JIT before measuring
- Don't benchmark in debug mode
- Isolate benchmarks from other CI jobs
- Pin the runner hardware to avoid variance
