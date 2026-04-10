---
title: Prometheus Exporters
tags: [prometheus, exporters, monitoring]
created: 2025-09-30
---
# Prometheus Exporters

## What Exporters Do

**Prometheus exporters** expose metrics from third-party systems in the Prometheus format. They bridge the gap between systems that don't natively expose `/metrics` endpoints.

## Essential Exporters

### Node Exporter
System-level metrics for Linux/macOS: CPU, memory, disk, network.

### Postgres Exporter
Database metrics: connections, locks, replication lag, table/index statistics.

### Redis Exporter
Redis metrics: memory usage, connected clients, keyspace, command stats.

### Blackbox Exporter
Probe endpoints via HTTP, TCP, ICMP, DNS. Use for synthetic monitoring.

## Custom Application Metrics

Instrument your application code directly:

```typescript
import { Counter, Histogram, Registry } from 'prom-client';

const registry = new Registry();

const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 5],
  registers: [registry],
});

// Middleware
app.use((req, res, next) => {
  const end = httpRequestDuration.startTimer();
  res.on('finish', () => {
    end({ method: req.method, route: req.route?.path, status: res.statusCode });
  });
  next();
});
```

## Cardinality Management

High-cardinality labels (user IDs, request IDs) create too many time series, causing Prometheus memory and performance issues. Keep label cardinality under 1000 per metric.

See [[perf-014]] for Prometheus fundamentals.
