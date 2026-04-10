# Distributed Tracing

## Problem

A single user request in a microservices system touches multiple services. When something goes wrong, you need to trace the request across all services.

## Concepts

- **Trace** — the full journey of a request through the system
- **Span** — a single operation within a trace (e.g., "query database")
- **Context propagation** — passing trace IDs across service boundaries

## Implementation

```typescript
// Middleware to propagate trace context
function tracingMiddleware(req: Request, res: Response, next: Function) {
  const traceId = req.headers['x-trace-id'] ?? generateTraceId();
  const spanId = generateSpanId();

  // Store in async context
  context.set({ traceId, spanId, parentSpanId: req.headers['x-span-id'] });

  // Propagate to downstream calls
  res.setHeader('x-trace-id', traceId);
  next();
}
```

## Tools

- **Jaeger** — open source, CNCF
- **Zipkin** — Twitter-originated
- **OpenTelemetry** — vendor-neutral standard (recommended)
- **Datadog APM** — commercial, integrated

## OpenTelemetry

Use the **OpenTelemetry SDK** for instrumentation. It supports traces, metrics, and logs with a single API.

See [[monitoring-prometheus]], [[arch-011]].
