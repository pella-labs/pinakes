# SLIs, SLOs, and SLAs

## Definitions

- **SLI** (Service Level Indicator): a quantitative measure of service quality (e.g., request latency p99)
- **SLO** (Service Level Objective): a target value for an SLI (e.g., p99 latency < 200ms)
- **SLA** (Service Level Agreement): a contractual commitment with consequences for missing SLOs

## Choosing Good SLIs

SLIs should measure what users experience. Common SLIs:

- **Availability**: proportion of successful requests
- **Latency**: distribution of response times
- **Throughput**: requests processed per unit time
- **Correctness**: proportion of responses with correct data

## Setting SLOs

Start with current performance, then set targets slightly above baseline. Common patterns:

- 99.9% availability (allows ~8.7 hours downtime/year)
- 99.95% availability (allows ~4.4 hours downtime/year)
- p99 latency < 500ms

Do not set SLOs tighter than necessary. Over-promising creates engineering burden with no user-visible benefit.

## Error Budgets

The **error budget** is 1 minus the SLO. A 99.9% availability SLO means you have a 0.1% error budget. When the budget is consumed, slow down feature releases and focus on reliability.

This creates a natural balance: product teams want to ship features, reliability teams want stability. The error budget is the shared language.

## Measuring and Reporting

Track SLO compliance over rolling windows (7-day, 30-day). Display burn rate on dashboards. Alert when the burn rate suggests the budget will be exhausted before the window ends.

See [[perf-016]] for alerting and [[perf-021]] for error budget policies.

## Implementation Approaches

### Prometheus-Based SLO Tracking

```promql
# Availability SLI: ratio of successful requests
sum(rate(http_requests_total{status!~"5.."}[30d]))
/
sum(rate(http_requests_total[30d]))

# Error budget remaining
1 - (
  (1 - (sum(rate(http_requests_total{status!~"5.."}[30d])) / sum(rate(http_requests_total[30d]))))
  /
  (1 - 0.999)  # 99.9% SLO target
)
```

### Google's Four Golden Signals

The original Google SRE book recommends monitoring four signals for every service:

1. **Latency**: time it takes to serve a request
2. **Traffic**: demand on the system (requests per second)
3. **Errors**: rate of failed requests
4. **Saturation**: how full the service is (CPU, memory, I/O)

These four signals provide comprehensive visibility into service health and naturally lead to meaningful SLIs.

### Client-Side vs Server-Side Measurement

Server-side SLIs miss failures that happen in the network layer: DNS failures, connection timeouts, TLS errors. Client-side SLIs capture the true user experience but are noisier (user device variability, network quality).

The ideal approach is measuring both and using client-side SLIs as the primary indicator, with server-side SLIs for debugging.
