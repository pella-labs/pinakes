---
title: Grafana Tempo for Traces
tags: [grafana, tempo, tracing]
created: 2025-10-15
---
# Grafana Tempo for Traces

## What Tempo Is

**Grafana Tempo** is a high-scale distributed tracing backend. It only indexes trace IDs, storing everything else in object storage. This makes it significantly cheaper than Jaeger with Elasticsearch.

## Architecture

- **Distributor**: receives spans from OTel Collector
- **Ingester**: batches spans into blocks
- **Compactor**: merges and compresses blocks
- **Querier**: searches blocks for traces
- **Object storage**: S3/GCS/Azure for long-term storage

## Configuration

```yaml
server:
  http_listen_port: 3200

distributor:
  receivers:
    otlp:
      protocols:
        grpc:

ingester:
  trace_idle_period: 10s
  max_block_bytes: 1073741824  # 1GB

compactor:
  compaction:
    block_retention: 336h  # 14 days

storage:
  trace:
    backend: s3
    s3:
      bucket: tempo-traces
      endpoint: s3.amazonaws.com
```

## TraceQL

Tempo's query language for searching traces:

```
{ span.http.status_code >= 500 && span.service.name = "api-gateway" }
{ duration > 2s && span.db.system = "postgresql" }
```

## Integration with Grafana

Tempo integrates with Grafana for trace visualization. Click from a log line in Loki to the corresponding trace in Tempo, or from a metric alert to exemplar traces.

See [[perf-065]] for Jaeger and [[perf-017]] for OpenTelemetry.
