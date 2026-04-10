# Monitoring Microservice Dependencies

## Service Dependency Maps

Automatically generate dependency maps from distributed traces. This reveals which services call which, how frequently, and with what error rates.

## Health Check Taxonomy

### Shallow Health Check
Returns 200 if the process is running. Only useful for load balancer membership.

### Deep Health Check
Verifies connectivity to dependencies (database, cache, message broker). More useful but can cascade: if the database is slow, all deep health checks are slow.

### Readiness vs Liveness
- **Liveness**: is the process alive? (restart if no)
- **Readiness**: can it serve traffic? (stop routing if no)

A service can be alive but not ready (still warming up, dependency down).

## Dependency Monitoring

For each dependency, track:

- Call rate
- Error rate
- Latency (p50, p99)
- Circuit breaker state
- Connection pool utilization

## Cascading Failure Detection

Alert when multiple services degrade simultaneously. This often indicates a shared dependency failure (database, DNS, network).

Pattern: if >3 services show elevated error rates within 5 minutes, open an incident for the shared infrastructure layer.

See [[perf-031]] for circuit breakers and [[perf-089]] for communication patterns.
