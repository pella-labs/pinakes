# Graceful Shutdown

## Why It Matters

Abrupt process termination drops in-flight requests, corrupts pending writes, and causes connection errors for clients. **Graceful shutdown** drains work before exiting.

## Implementation

```typescript
import { createServer } from 'http';

const server = createServer(handleRequest);
let isShuttingDown = false;

server.listen(3000);

process.on('SIGTERM', async () => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  
  logger.info('shutdown initiated');

  // 1. Stop accepting new connections
  server.close(() => {
    logger.info('http server closed');
  });

  // 2. Stop accepting new work from queues
  await consumer.stop();

  // 3. Wait for in-flight work to complete
  await waitForInflightRequests(30000); // 30s timeout

  // 4. Close database connections
  await db.end();
  await redis.quit();

  // 5. Flush telemetry
  await otelSdk.shutdown();

  logger.info('shutdown complete');
  process.exit(0);
});

// Health check returns 503 during shutdown
app.get('/health', (req, res) => {
  res.status(isShuttingDown ? 503 : 200).json({ status: isShuttingDown ? 'draining' : 'ok' });
});
```

## Kubernetes Integration

Set `terminationGracePeriodSeconds` to allow enough time for graceful shutdown. The default (30s) is often sufficient but may need increasing for long-running operations.

## Pre-Stop Hooks

Use a Kubernetes **preStop** hook to remove the pod from the load balancer before sending SIGTERM. This prevents new requests from arriving during shutdown.

See [[perf-029]] for load balancing and [[perf-035]] for graceful degradation.
