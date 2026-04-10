---
title: Kubernetes Resource Limits
tags: [kubernetes, resources, performance]
---
# Kubernetes Resource Limits

## Requests vs Limits

- **Requests**: guaranteed resources. The scheduler uses this to place pods.
- **Limits**: maximum resources. The kernel enforces this.

```yaml
resources:
  requests:
    cpu: 250m
    memory: 256Mi
  limits:
    cpu: 1000m
    memory: 512Mi
```

## CPU Throttling

When a container exceeds its CPU limit, it gets **throttled** — the kernel delays its execution. This manifests as increased latency, not errors. Throttling is invisible unless you monitor `container_cpu_cfs_throttled_seconds_total`.

## Memory OOM Kills

When a container exceeds its memory limit, the kernel sends SIGKILL. The container restarts, losing all in-flight work. Set memory limits with headroom above observed usage.

## Right-Sizing

Use historical metrics to right-size resources:

```promql
# CPU usage vs request
container_cpu_usage_seconds_total / container_spec_cpu_quota * container_spec_cpu_period

# Memory usage vs limit
container_memory_working_set_bytes / container_spec_memory_limit_bytes
```

## Vertical Pod Autoscaler

The **VPA** automatically adjusts resource requests based on observed usage. Use in recommendation mode first to validate suggestions before enabling auto-updates.

## Common Mistakes

- Setting CPU limits too tight causes throttling and latency spikes
- Setting memory requests too low causes pod eviction under memory pressure
- Not setting any limits allows a single pod to starve others

See [[perf-025]] for capacity planning.
