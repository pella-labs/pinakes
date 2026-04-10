# Cost Optimization for Observability

## The Data Volume Problem

Observability data grows with traffic. Without control, telemetry costs can exceed infrastructure costs.

## Metrics Cardinality Management

Every unique label combination creates a new time series. Control cardinality:

```typescript
// BAD: user_id label creates millions of series
metrics.increment('api_requests', { user_id: req.userId });

// GOOD: aggregate by user tier
metrics.increment('api_requests', { user_tier: req.userTier });
```

## Trace Sampling Strategies

- **Head sampling**: decide at trace start (cheapest, least accurate)
- **Tail sampling**: decide after trace completes (costlier, keeps interesting traces)
- **Rule-based**: 100% of errors, 100% of slow traces, 1% of everything else

## Log Reduction

- Drop DEBUG logs in production
- Sample verbose INFO logs (1 in 100)
- Aggregate repeated log patterns
- Strip unnecessary fields before shipping

## Tiered Retention

```yaml
# Keep recent data in hot storage for fast queries
hot_retention: 7d

# Move to warm storage (compressed) 
warm_retention: 30d

# Archive to cold storage (S3/GCS)
cold_retention: 365d
```

## Budget Allocation

Typical observability cost split:
- Metrics: 30% (low volume, high retention)
- Traces: 40% (high volume, heavy sampling)
- Logs: 30% (medium volume, variable retention)

See [[perf-073]] for observability pipeline and [[perf-097]].
