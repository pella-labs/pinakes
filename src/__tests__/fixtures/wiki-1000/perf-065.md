# Distributed Tracing with Jaeger

## Architecture

**Jaeger** is a distributed tracing backend that stores and queries traces. Components:

- **Agent**: receives spans from applications, forwards to collector
- **Collector**: validates, indexes, and stores spans
- **Query**: serves the Jaeger UI
- **Storage**: Elasticsearch, Cassandra, or Kafka

## Deployment Patterns

### All-in-One
Single binary for development. Not for production.

### Production Topology
Agents as sidecars or DaemonSets, collectors behind a load balancer, dedicated storage cluster.

## Sampling Configuration

Configure sampling at the collector level:

```json
{
  "service_strategies": [
    {
      "service": "payment-service",
      "type": "probabilistic",
      "param": 0.1
    },
    {
      "service": "health-check",
      "type": "probabilistic",
      "param": 0.001
    }
  ],
  "default_strategy": {
    "type": "probabilistic",
    "param": 0.01
  }
}
```

## Trace Analysis Patterns

Look for:
- Spans with high self-time (the bottleneck)
- Excessive span count per trace (instrumentation noise)
- Missing spans (broken context propagation)
- Long gaps between spans (network latency or untraced work)

See [[perf-018]] for tracing patterns and [[perf-017]] for OpenTelemetry.
