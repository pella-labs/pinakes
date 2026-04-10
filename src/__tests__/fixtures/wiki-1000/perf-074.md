# Tail Latency and Its Causes

## What Tail Latency Is

**Tail latency** refers to the slowest responses — the p99, p99.9, or p99.99. For user-facing services, the tail is what your unhappiest users experience.

## Why Tail Latency Matters

If a single page load makes 50 backend calls, and each has a 1% chance of being slow, the probability of at least one slow call is: `1 - (0.99)^50 = 39.5%`. Nearly 40% of page loads are affected by tail latency.

## Common Causes

### Garbage Collection
GC pauses affect individual requests unpredictably. Tune GC or use languages with deterministic memory management for latency-sensitive paths.

### Shared Resources
Noisy neighbors: another process on the same host consuming CPU or I/O. Use resource isolation (cgroups, dedicated instances).

### Background Tasks
Cron jobs, log rotation, backups that consume I/O or CPU during request processing.

### Queue Depth
Under load, requests queue up. The last request in the queue waits for all preceding requests to complete.

### DNS Resolution
Occasional DNS lookups that hit a resolver instead of cache.

## Mitigation Strategies

- **Hedging**: send the same request to multiple backends, use the first response
- **Timeouts**: cap the maximum wait time per downstream call
- **Isolation**: dedicate resources for latency-sensitive services
- **Preemption**: prioritize latency-sensitive work over background tasks

See [[perf-034]] for timeout design.
