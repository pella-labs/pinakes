# Flaky Test Detection and Elimination

A **flaky test** is one that passes and fails intermittently without any code change. Flaky tests erode trust in the CI pipeline and waste developer time.

## Common Causes

- **Timing dependencies**: Relying on setTimeout or animation frames
- **Shared mutable state**: Tests polluting each other through global state
- **Network calls**: Tests hitting real external services
- **Resource contention**: File locks, port conflicts, database connections
- **Non-deterministic data**: Random values, UUIDs, timestamps
- **Race conditions**: Async operations completing in unexpected order

## Detection Strategies

### Repeated Execution

```bash
# Run each test 10 times to catch intermittent failures
vitest --repeat 10
```

### Historical Analysis

Track test results over time. A test that fails 5% of runs is flaky even if it passes most of the time. CI platforms like **BuildPulse** and **Datadog CI** provide flaky test dashboards.

## Elimination Tactics

1. **Isolate state**: Each test gets its own database, temp directory, and random seed
2. **Deterministic time**: Use fake timers instead of real ones
3. **Retry with logging**: If a test is flaky, add detailed logging before retrying to capture the root cause
4. **Quarantine**: Move flaky tests to a separate suite that doesn't block merges while they're being fixed

## The Quarantine Anti-Pattern

Quarantining is a short-term fix. Tests that stay quarantined for weeks become permanently ignored. Set a time limit: if a quarantined test isn't fixed within 5 days, either fix it or delete it.
