# Grafana Dashboard Design

## Dashboard Hierarchy

Organize dashboards in a three-level hierarchy:

1. **Overview dashboard**: high-level health of all services (RED metrics)
2. **Service dashboard**: detailed metrics for one service
3. **Debug dashboard**: low-level metrics for troubleshooting

## The RED Method

Every service dashboard should show:

- **Rate**: requests per second
- **Errors**: error rate as a percentage of requests
- **Duration**: latency distribution (p50, p90, p99)

## Panel Best Practices

- Use **time series** panels for metrics over time
- Use **stat** panels for current values (error rate, uptime)
- Use **heatmap** for latency distributions
- Use **table** panels for top-N breakdowns
- Avoid pie charts — they are almost never the right visualization for operational data

## Template Variables

Use **template variables** for service name, environment, and instance. This lets one dashboard serve all environments without duplication.

## Annotations

Mark deployments, incidents, and config changes as **annotations** on time series panels. This makes it immediately obvious when a metric change correlates with a deployment.

## Alert Integration

Embed alert status panels in dashboards so operators can see which alerts are firing without switching to the alerting UI.

See [[perf-014]] for Prometheus metrics and [[perf-016]] for alerting strategies.
