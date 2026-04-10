# Graceful Shutdown

## Why It Matters

Abrupt shutdown kills in-flight requests and leaves resources in an inconsistent state.

## Steps

1. Receive SIGTERM
2. Stop accepting new requests
3. Wait for in-flight requests to complete (with timeout)
4. Close database connections
5. Flush logs and metrics
6. Exit

## Node.js Implementation

```typescript
const server = app.listen(8080);

process.on('SIGTERM', () => {
  logger.info('SIGTERM received, starting graceful shutdown');

  server.close(() => {
    logger.info('HTTP server closed');
  });

  // Give in-flight requests time to complete
  setTimeout(() => {
    logger.warn('Forcing shutdown after timeout');
    process.exit(1);
  }, 30000);

  // Close DB connections
  db.close();

  // Flush metrics
  metrics.flush();
});
```

## Kubernetes

K8s sends SIGTERM, waits `terminationGracePeriodSeconds` (default 30s), then sends SIGKILL.

```yaml
spec:
  terminationGracePeriodSeconds: 45
  containers:
    - name: app
      lifecycle:
        preStop:
          exec:
            command: ["/bin/sh", "-c", "sleep 5"]  # allow LB to drain
```

See [[k8s-deployment]], [[arch-060]].
