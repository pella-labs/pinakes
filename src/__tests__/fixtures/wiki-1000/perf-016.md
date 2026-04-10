# Alerting Strategies

## Alert on Symptoms, Not Causes

Alert on user-facing symptoms: high error rate, elevated latency, low throughput. Do not alert on CPU usage, memory pressure, or disk space directly unless they represent imminent resource exhaustion.

## Alert Fatigue

The fastest way to make alerting useless is to create too many alerts. Every alert should be:

- **Actionable**: someone can do something about it right now
- **Urgent**: it needs attention within the alert's SLA
- **Unambiguous**: the alert text explains what's wrong

If an alert fires and the response is "ignore it," delete the alert.

## Severity Levels

| Level | Response Time | Example |
|---|---|---|
| P1 / Critical | < 15 min | Service down, data loss risk |
| P2 / Warning | < 1 hour | Error rate elevated but service functional |
| P3 / Info | Next business day | Disk approaching 80% |

## Multi-Window Alerts

Use **multi-window, multi-burn-rate** alerts for SLO-based alerting. A fast burn (consuming 5% of error budget in 1 hour) pages immediately. A slow burn (consuming 10% of budget in 6 hours) creates a ticket.

```yaml
# Fast burn alert
- alert: HighErrorBurnRate
  expr: |
    (
      sum(rate(http_errors_total[1h])) / sum(rate(http_requests_total[1h]))
    ) > (14.4 * 0.001)
  for: 2m
  labels:
    severity: critical
```

## Runbook Links

Every alert must link to a **runbook** that describes: what the alert means, how to diagnose the root cause, and what actions to take.

See [[perf-014]] for Prometheus and [[perf-020]] for SLOs.
