---
source: ai-generated
---
# Observability Pillars

## The Three Pillars

1. **Metrics** — numeric measurements over time (latency p99, error rate, throughput)
2. **Logs** — discrete events with context (structured JSON)
3. **Traces** — request paths across services

## Beyond Three Pillars

Modern observability adds:
- **Profiling** — CPU/memory usage at the code level
- **Events** — deployments, config changes, incidents
- **SLOs** — service level objectives as a unifying framework

## Tooling Stack

| Pillar | Tools |
|---|---|
| Metrics | Prometheus, Grafana, Datadog |
| Logs | ELK (Elasticsearch, Logstash, Kibana), Loki |
| Traces | Jaeger, Zipkin, Tempo |
| All-in-one | Datadog, New Relic, Honeycomb |

## Key Metrics

For any service, track the **RED metrics**:
- **R**ate — requests per second
- **E**rrors — error rate
- **D**uration — latency distribution (p50, p95, p99)

For infrastructure, track the **USE metrics**:
- **U**tilization — % of resource used
- **S**aturation — queue depth, backpressure
- **E**rrors — hardware/resource errors

See [[monitoring-prometheus]], [[arch-068]], [[arch-069]].
