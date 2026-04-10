# Prometheus Service Discovery

## Static vs Dynamic

Static targets are defined in the Prometheus config file. Dynamic **service discovery** automatically finds and scrapes targets as they scale.

## Kubernetes Service Discovery

```yaml
scrape_configs:
  - job_name: kubernetes-pods
    kubernetes_sd_configs:
      - role: pod
    relabel_configs:
      - source_labels: [__meta_kubernetes_pod_annotation_prometheus_io_scrape]
        action: keep
        regex: true
      - source_labels: [__meta_kubernetes_pod_annotation_prometheus_io_port]
        action: replace
        target_label: __address__
        regex: (.+)
        replacement: ${1}:${2}
```

Pods opt in by adding annotations:

```yaml
metadata:
  annotations:
    prometheus.io/scrape: "true"
    prometheus.io/port: "9090"
    prometheus.io/path: "/metrics"
```

## Consul Service Discovery

```yaml
scrape_configs:
  - job_name: consul
    consul_sd_configs:
      - server: consul:8500
        services: []
    relabel_configs:
      - source_labels: [__meta_consul_tags]
        regex: .*,monitor,.*
        action: keep
```

## Relabeling

Relabeling transforms discovered metadata into Prometheus labels. Use it to filter targets, set job names, and extract useful metadata from service discovery annotations.

See [[perf-014]] for Prometheus fundamentals and [[perf-070]] for exporters.
