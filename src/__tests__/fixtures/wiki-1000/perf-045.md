# Application Performance Management (APM)

## What APM Covers

An **APM** platform provides end-to-end visibility into application performance:

- Transaction traces (distributed tracing)
- Error tracking and aggregation
- Infrastructure metrics correlation
- Service maps and dependency visualization
- Real User Monitoring (RUM)

## Key Metrics to Track

### Apdex Score
Application Performance Index: the ratio of satisfactory responses to total responses. Apdex = (satisfied + tolerating/2) / total. Target: >0.9.

### Error Rate
Percentage of requests resulting in errors. Alert on sudden increases rather than absolute thresholds.

### Throughput
Requests per minute/second. Useful for capacity planning and anomaly detection.

### Response Time Distribution
p50, p90, p95, p99. The p99 is what your unhappiest users experience.

## Instrumentation Strategy

1. Auto-instrument frameworks and libraries (HTTP, DB, cache)
2. Add manual spans for business-critical operations
3. Add custom attributes for business context
4. Sample appropriately (100% in dev, 1-10% in prod for high-traffic services)

## Cost Management

APM vendors charge by ingested data volume. Control costs by:

- Sampling traces rather than sending 100%
- Filtering out health check endpoints
- Reducing metric cardinality
- Using tiered retention policies

See [[perf-017]] for OpenTelemetry and [[perf-018]] for tracing.

## Open Source APM Stack

An open-source APM stack can replace commercial tools:

| Component | Tool | Purpose |
|---|---|---|
| Metrics | Prometheus + Grafana | Metric collection and visualization |
| Traces | OpenTelemetry + Tempo/Jaeger | Distributed tracing |
| Logs | Loki + Grafana | Log aggregation and search |
| Alerting | Alertmanager | Alert routing and grouping |
| Profiling | Pyroscope | Continuous profiling |
| Synthetic | Grafana Synthetic Monitoring | Uptime and performance probes |

### Grafana as the Unified UI

Grafana serves as the single pane of glass. From one dashboard, you can:

- View metrics and see exemplar traces
- Click through to full traces in Tempo
- Jump from trace spans to correlated logs in Loki
- View continuous profiles for the same time window

This correlation across signals is what makes observability powerful — no single signal tells the whole story. The ability to seamlessly pivot between metrics, traces, logs, and profiles during incident investigation dramatically reduces mean time to resolution.

### Self-Hosting Considerations

Running your own observability stack requires dedicated operational effort. Consider:

- Storage growth (metrics, traces, and logs all grow with traffic)
- High availability for the observability stack itself (who monitors the monitors?)
- Retention policies and cost management
- Upgrade and maintenance burden

For small teams, managed solutions (Grafana Cloud, Datadog, New Relic) may be more cost-effective when factoring in engineering time.
