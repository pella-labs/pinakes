# Grafana Alerting

## Grafana Managed Alerts

Grafana 9+ includes a built-in alerting engine that evaluates alert rules against any data source, not just Prometheus.

## Alert Rule Structure

```yaml
apiVersion: 1
groups:
  - orgId: 1
    name: api-health
    folder: Production
    interval: 1m
    rules:
      - uid: api-error-rate
        title: High API Error Rate
        condition: C
        data:
          - refId: A
            relativeTimeRange:
              from: 300
              to: 0
            model:
              expr: sum(rate(http_errors_total[5m])) / sum(rate(http_requests_total[5m]))
          - refId: C
            relativeTimeRange:
              from: 0
              to: 0
            model:
              type: threshold
              conditions:
                - evaluator:
                    type: gt
                    params: [0.05]
```

## Contact Points

Route alerts to multiple channels:

- Slack for warnings
- PagerDuty for critical
- Email for weekly summaries
- Webhooks for custom integrations

## Notification Policies

Control which alerts go where:

- Group by `namespace` and `alertname`
- Route `severity=critical` to PagerDuty with 0s group wait
- Route `severity=warning` to Slack with 5m group wait
- Mute during maintenance windows

See [[perf-015]] for dashboard design and [[perf-016]] for alerting strategy.
