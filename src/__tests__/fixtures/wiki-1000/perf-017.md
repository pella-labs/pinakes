# OpenTelemetry Introduction

## The Three Pillars

**OpenTelemetry** (OTel) unifies the three pillars of observability under one SDK:

- **Traces**: distributed request flow across services
- **Metrics**: quantitative measurements of system behavior
- **Logs**: discrete events with structured context

## Architecture

OTel follows a pipeline model:

1. **Instrumentation**: generates telemetry data (auto or manual)
2. **SDK**: processes and batches data
3. **Exporter**: sends data to a backend (Jaeger, Prometheus, etc.)
4. **Collector**: optional intermediary for routing, filtering, sampling

## Auto-Instrumentation

OTel provides auto-instrumentation for common libraries. In Node.js:

```typescript
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';

const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter({ url: 'http://localhost:4318/v1/traces' }),
  instrumentations: [getNodeAutoInstrumentations()],
});

sdk.start();
```

This automatically instruments HTTP, gRPC, database clients, and more without code changes.

## Context Propagation

The **W3C Trace Context** header (`traceparent`) propagates trace IDs across service boundaries. Every outgoing HTTP request includes this header so the receiving service can continue the trace.

See [[perf-018]] for distributed tracing patterns.
