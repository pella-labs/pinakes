---
title: Prometheus PromQL Patterns
tags: [prometheus, promql, monitoring]
---
# Prometheus PromQL Patterns

## Rate vs Irate

```promql
# rate: per-second average over the range
rate(http_requests_total[5m])

# irate: per-second rate between the last two data points
irate(http_requests_total[5m])
```

Use `rate` for alerting (smoother). Use `irate` for dashboards (more responsive to changes).

## Error Rate Calculation

```promql
# Error percentage
sum(rate(http_requests_total{status=~"5.."}[5m]))
/
sum(rate(http_requests_total[5m]))
* 100
```

## Histogram Percentiles

```promql
# p99 latency by service
histogram_quantile(0.99,
  sum by (le, service) (
    rate(http_request_duration_seconds_bucket[5m])
  )
)
```

## Aggregation Across Instances

```promql
# Total RPS across all instances of a service
sum by (service) (rate(http_requests_total[5m]))

# Top 5 endpoints by request rate
topk(5, sum by (endpoint) (rate(http_requests_total[5m])))
```

## Absent Metrics Alert

```promql
# Alert when a scrape target disappears
absent(up{job="payment-service"} == 1)
```

## Recording Rules for Dashboard Performance

Pre-compute expensive queries:

```yaml
groups:
  - name: sli_recording_rules
    interval: 30s
    rules:
      - record: sli:http_errors:ratio_rate5m
        expr: |
          sum(rate(http_requests_total{status=~"5.."}[5m]))
          / sum(rate(http_requests_total[5m]))
```

See [[perf-014]] for Prometheus fundamentals and [[perf-015]] for Grafana.
