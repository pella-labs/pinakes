# Graceful Degradation

## Philosophy

When parts of a system fail, serve a degraded but functional experience rather than a complete error. Users prefer a slow, incomplete page over a blank error screen.

## Degradation Levels

### Level 1: Feature Disabling
Disable non-critical features. If the recommendation engine is down, show a static list instead.

### Level 2: Stale Data
Serve cached data past its TTL. Mark it as potentially stale in the UI.

### Level 3: Reduced Fidelity
Switch from real-time to batch data. Show summaries instead of details.

### Level 4: Static Fallback
Serve a pre-rendered static page when dynamic rendering fails entirely.

## Implementation Checklist

- Identify which features are critical vs nice-to-have
- Implement fallback paths for each non-critical feature
- Test degradation paths regularly (chaos engineering)
- Monitor which degradation modes are active
- Set up alerts when degradation is triggered

## Feature Flags for Degradation

Use **feature flags** to quickly disable resource-intensive features during incidents without deploying new code. Pre-configure kill switches for:

- Search (falls back to browse)
- Personalization (falls back to popular items)
- Real-time data (falls back to cached)
- Analytics tracking (drops events)

See [[perf-031]] for circuit breakers and [[perf-036]] for chaos engineering.
