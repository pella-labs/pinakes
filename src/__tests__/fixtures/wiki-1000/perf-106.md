# Monitoring Kubernetes Workloads

## Essential Metrics

### Pod-Level
- `container_cpu_usage_seconds_total`: actual CPU consumption
- `container_memory_working_set_bytes`: memory in use
- `container_cpu_cfs_throttled_seconds_total`: CPU throttling
- `kube_pod_status_phase`: pod lifecycle state

### Deployment-Level
- `kube_deployment_status_replicas_available`: healthy replicas
- `kube_deployment_status_replicas_unavailable`: unhealthy replicas
- Deployment rollout status and progress

### Node-Level
- `node_cpu_seconds_total`: node CPU usage
- `node_memory_MemAvailable_bytes`: available memory
- `node_disk_io_time_seconds_total`: disk I/O pressure
- `node_network_transmit_bytes_total`: network throughput

## Important Alerts

```yaml
groups:
  - name: kubernetes
    rules:
      - alert: PodCrashLooping
        expr: rate(kube_pod_container_status_restarts_total[15m]) > 0
        for: 5m
        labels:
          severity: warning

      - alert: HighMemoryUsage
        expr: |
          container_memory_working_set_bytes / container_spec_memory_limit_bytes > 0.9
        for: 5m
        labels:
          severity: warning
```

## Resource Quota Monitoring

Monitor namespace-level resource quotas to prevent teams from exceeding their allocation or running out of quota for new deployments.

See [[perf-075]] for resource limits and [[perf-076]] for autoscaling.
