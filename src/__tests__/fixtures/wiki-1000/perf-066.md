# Log Aggregation with Loki

## Loki's Design Philosophy

**Grafana Loki** indexes only log metadata (labels), not the full log content. This makes it significantly cheaper to operate than Elasticsearch-based solutions.

## Label Design

Labels are the primary query dimension. Keep cardinality low:

- Good labels: `service`, `environment`, `level`
- Bad labels: `user_id`, `request_id`, `trace_id` (too many unique values)

High-cardinality labels create too many streams, degrading performance.

## LogQL Basics

```promql
# Filter by label and content
{service="api-gateway"} |= "error" | json | status >= 500

# Count errors per minute
count_over_time({service="api-gateway"} |= "error" [1m])

# Parse and aggregate
{service="api-gateway"} | json | __error__="" | unwrap duration | avg_over_time([5m]) by (endpoint)
```

## Retention and Storage

Loki stores logs in object storage (S3, GCS) with a configurable retention period. Use tiered retention:

- Hot: recent logs on local SSD (fast queries)
- Cold: older logs in object storage (cheap, slower)

## Integration with Tracing

Link logs to traces using the trace ID label. In Grafana, click a log line to jump directly to the corresponding trace in Tempo or Jaeger.

See [[perf-019]] for structured logging and [[perf-065]] for Jaeger.
