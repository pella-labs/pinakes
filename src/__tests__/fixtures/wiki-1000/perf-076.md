# Horizontal Pod Autoscaling

## How HPA Works

The **Horizontal Pod Autoscaler** adjusts replica count based on observed metrics. The control loop runs every 15 seconds by default.

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: api-server
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: api-server
  minReplicas: 3
  maxReplicas: 20
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
    - type: Pods
      pods:
        metric:
          name: http_requests_per_second
        target:
          type: AverageValue
          averageValue: "100"
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 60
      policies:
        - type: Percent
          value: 50
          periodSeconds: 60
    scaleDown:
      stabilizationWindowSeconds: 300
      policies:
        - type: Percent
          value: 10
          periodSeconds: 60
```

## Custom Metrics

Scale on application-specific metrics (queue depth, active connections) via the custom metrics API and Prometheus adapter.

## Scaling Behavior

- Scale up aggressively (react quickly to load)
- Scale down conservatively (avoid flapping)
- Use stabilization windows to smooth rapid oscillation

See [[perf-075]] for resource limits and [[perf-025]] for capacity planning.
