---
title: Prometheus Federation
tags: [prometheus, federation, scaling]
---
# Prometheus Federation

## Why Federate

A single Prometheus instance has limits: ~10 million active time series before performance degrades. **Federation** allows hierarchical or cross-service aggregation.

## Hierarchical Federation

Lower-level Prometheus instances scrape local targets. A global Prometheus federates pre-aggregated metrics from them.

```yaml
# Global Prometheus config
scrape_configs:
  - job_name: 'federate'
    scrape_interval: 30s
    honor_labels: true
    metrics_path: '/federate'
    params:
      'match[]':
        - '{__name__=~"job:.*"}'  # only pre-aggregated recording rules
    static_configs:
      - targets:
          - 'prometheus-us-east:9090'
          - 'prometheus-eu-west:9090'
          - 'prometheus-ap-south:9090'
```

## Cross-Service Federation

Each team runs their own Prometheus. A central instance federates SLI metrics from all teams for organization-wide SLO tracking.

## Alternatives to Federation

- **Thanos**: long-term storage with global query across Prometheus instances
- **Cortex/Mimir**: horizontally scalable Prometheus-compatible storage
- **Victoria Metrics**: high-performance Prometheus alternative

## Best Practices

- Only federate pre-aggregated recording rules, not raw metrics
- Use recording rules at the source to reduce federation traffic
- Set appropriate scrape intervals for federated targets (30s-60s)

See [[perf-014]] for Prometheus fundamentals and [[perf-093]] for service discovery.
