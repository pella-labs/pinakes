# Observability Data Pipeline

## The Data Flow

Telemetry data flows from applications through a pipeline:

1. **Generation**: applications produce metrics, traces, and logs
2. **Collection**: agents and collectors gather data
3. **Processing**: filter, transform, enrich, sample
4. **Storage**: write to appropriate backends
5. **Query**: dashboards, alerts, and ad-hoc analysis

## OpenTelemetry Collector

The **OTel Collector** is the universal processing layer. It receives data from multiple sources, processes it, and exports to multiple destinations:

```yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

processors:
  batch:
    timeout: 5s
    send_batch_size: 1024
  filter:
    traces:
      span:
        - 'attributes["http.route"] == "/health"'  # drop health checks
  attributes:
    actions:
      - key: environment
        value: production
        action: upsert

exporters:
  prometheus:
    endpoint: 0.0.0.0:8889
  otlp:
    endpoint: tempo:4317
  loki:
    endpoint: http://loki:3100/loki/api/v1/push

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [batch, filter]
      exporters: [otlp]
    metrics:
      receivers: [otlp]
      processors: [batch, attributes]
      exporters: [prometheus]
```

## Cost Control

Telemetry data volume grows with traffic. Control costs by sampling traces, dropping verbose log fields, and aggregating metrics before storage.

See [[perf-017]] for OpenTelemetry and [[perf-066]] for Loki.
