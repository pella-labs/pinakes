# Alertmanager Configuration

## Routing and Grouping

Alertmanager routes alerts based on labels. Group related alerts to prevent notification storms:

```yaml
route:
  receiver: default-slack
  group_by: ['alertname', 'service']
  group_wait: 30s        # wait before sending first notification
  group_interval: 5m     # wait before sending updated notification
  repeat_interval: 4h    # re-send if still firing

  routes:
    - match:
        severity: critical
      receiver: pagerduty-oncall
      group_wait: 10s

    - match:
        severity: warning
      receiver: slack-warnings
      group_wait: 1m
```

## Inhibition Rules

Suppress noisy alerts when a parent alert is firing:

```yaml
inhibit_rules:
  - source_match:
      alertname: ClusterDown
    target_match:
      alertname: NodeDown
    equal: ['cluster']
```

If the entire cluster is down, don't send individual node-down alerts.

## Silences

Temporarily mute alerts during maintenance windows. Create silences via the API or UI with a matcher and duration.

## Notification Templates

Customize alert messages for each channel:

```yaml
receivers:
  - name: slack-warnings
    slack_configs:
      - channel: '#alerts-warning'
        title: '{{ .GroupLabels.alertname }}'
        text: '{{ range .Alerts }}{{ .Annotations.summary }}\n{{ end }}'
```

See [[perf-016]] for alerting strategies and [[perf-014]] for Prometheus.
