# Metric Aggregation Strategies

## Pre-Aggregation vs Post-Aggregation

**Pre-aggregation** computes summaries at collection time (recording rules, roll-ups). Lower storage cost, faster queries, but you lose detail.

**Post-aggregation** stores raw data and computes summaries at query time. Flexible but expensive for high-cardinality data.

## Prometheus Recording Rules

Pre-compute expensive queries:

```yaml
groups:
  - name: api-aggregations
    interval: 30s
    rules:
      - record: api:request_duration:p99_5m
        expr: histogram_quantile(0.99, sum(rate(http_request_duration_seconds_bucket[5m])) by (le, service))

      - record: api:error_rate:ratio_5m
        expr: sum(rate(http_requests_total{status=~"5.."}[5m])) by (service) / sum(rate(http_requests_total[5m])) by (service)
```

## Downsampling

Reduce the resolution of historical data to save storage:

- Last 24 hours: 15-second resolution
- Last 7 days: 1-minute resolution
- Last 30 days: 5-minute resolution
- Last year: 1-hour resolution

## Metric Naming for Aggregation

Design metric names and labels for efficient aggregation. Use consistent label names across services so cross-service queries work naturally.

See [[perf-063]] for PromQL patterns and [[perf-097]] for cost optimization.
