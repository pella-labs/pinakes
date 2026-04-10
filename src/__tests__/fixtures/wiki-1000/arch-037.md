# Health Check Patterns

## Types

### Liveness
"Is the process running?" If this fails, restart the process.

### Readiness
"Can the process serve traffic?" If this fails, remove from load balancer but don't restart.

### Startup
"Has the process finished initializing?" Prevents liveness checks from killing slow-starting apps.

## Implementation

```typescript
app.get('/health/live', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.get('/health/ready', async (req, res) => {
  const dbOk = await checkDatabase();
  const cacheOk = await checkRedis();

  if (dbOk && cacheOk) {
    res.status(200).json({ status: 'ready', checks: { db: 'ok', cache: 'ok' } });
  } else {
    res.status(503).json({ status: 'not_ready', checks: { db: dbOk ? 'ok' : 'fail', cache: cacheOk ? 'ok' : 'fail' } });
  }
});
```

## Kubernetes Configuration

```yaml
livenessProbe:
  httpGet:
    path: /health/live
    port: 8080
  initialDelaySeconds: 5
  periodSeconds: 10
readinessProbe:
  httpGet:
    path: /health/ready
    port: 8080
  periodSeconds: 5
```

See [[k8s-deployment]], [[monitoring-prometheus]].
