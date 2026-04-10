---
source: extracted
confidence: ambiguous
---

# Distributed Tracing

**Distributed tracing** tracks requests as they flow through multiple services in a distributed system. Each service adds its own span to the trace, creating a tree of operations that shows exactly where time is spent and where failures occur.

## Core Concepts

A **trace** represents an entire request journey. It contains multiple **spans**, each representing a unit of work in a single service. Spans have:

- A trace ID (shared across all spans in the trace)
- A span ID (unique to this span)
- A parent span ID (links to the calling span)
- Start time and duration
- Tags/attributes (HTTP method, status code, service name)
- Events/logs (application-level annotations)

## Context Propagation

The trace context must propagate across service boundaries. The W3C Trace Context standard defines two headers:

- `traceparent`: version, trace-id, parent-id, trace-flags
- `tracestate`: vendor-specific key-value pairs

```typescript
// Middleware that extracts and propagates trace context
function tracingMiddleware(req: Request, res: Response, next: NextFunction): void {
  const traceparent = req.headers['traceparent'] as string;
  const span = tracer.startSpan('http.request', {
    parent: extractContext(traceparent),
    attributes: {
      'http.method': req.method,
      'http.url': req.url,
      'http.target': req.path,
    },
  });

  // Inject trace context into outbound calls
  res.locals.traceContext = span.context();

  res.on('finish', () => {
    span.setAttribute('http.status_code', res.statusCode);
    span.end();
  });

  next();
}
```

## Sampling

Tracing every request is expensive. Sampling strategies:

- **Head-based**: decide at the entry point whether to trace (e.g., 1% of requests)
- **Tail-based**: collect all spans, decide after the fact which traces to keep (keep errors, slow requests)

## Tooling

OpenTelemetry is the standard. It provides SDKs for instrumentation and a collector for receiving, processing, and exporting spans. Backend options: Jaeger, Zipkin, Grafana Tempo, Datadog, Honeycomb.

In a [[arch-006]] service mesh, the sidecar proxies generate infrastructure-level spans automatically. Application-level instrumentation adds business context.

See [[monitoring-setup]] for how tracing fits into the broader observability stack alongside metrics and logging.
