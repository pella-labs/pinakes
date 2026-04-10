# Prometheus Monitoring

## Pull-Based Architecture

**Prometheus** scrapes metrics from application endpoints at regular intervals. This is fundamentally different from push-based systems like StatsD. The pull model means Prometheus controls the sampling rate and can detect when targets are down.

## Metric Types

### Counter

A monotonically increasing value. Use for request counts, error counts, bytes processed.

```promql
# Request rate over the last 5 minutes
rate(http_requests_total[5m])
```

### Gauge

A value that can go up and down. Use for temperature, queue depth, active connections.

### Histogram

Samples observations and counts them in configurable buckets. Use for request durations, response sizes.

```promql
# 95th percentile request duration
histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))
```

### Summary

Similar to histogram but calculates quantiles client-side. Less flexible for aggregation across instances.

## Naming Conventions

- Use `snake_case`
- Include the unit: `_seconds`, `_bytes`, `_total`
- Counters should end with `_total`
- Use labels for dimensions, not metric names

## Recording Rules

Pre-compute expensive queries as **recording rules** to keep dashboards fast:

```yaml
groups:
  - name: http
    rules:
      - record: job:http_requests:rate5m
        expr: rate(http_requests_total[5m])
```

See [[perf-015]] for Grafana dashboards and [[perf-016]] for alerting.
