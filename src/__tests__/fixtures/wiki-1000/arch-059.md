# Canary Deployment

## Concept

Route a small percentage of traffic to the new version. Monitor for errors and performance regressions. Gradually increase traffic if healthy.

## Rollout Steps

1. Deploy new version alongside old (1% traffic)
2. Monitor error rates, latency, business metrics
3. Increase to 5%, 10%, 25%, 50%
4. If metrics degrade at any step, roll back
5. Promote to 100%

## Automation

```yaml
# Argo Rollouts canary strategy
spec:
  strategy:
    canary:
      steps:
        - setWeight: 5
        - pause: { duration: 5m }
        - setWeight: 20
        - pause: { duration: 10m }
        - setWeight: 50
        - pause: { duration: 15m }
        - setWeight: 100
      canaryMetrics:
        - name: error-rate
          threshold: 0.01
          interval: 1m
```

## Feature Flags vs. Canary

Feature flags are user-level (this user sees feature X). Canary is infrastructure-level (this instance runs version Y). They complement each other.

See [[arch-058]], [[arch-032]], [[monitoring-prometheus]].
