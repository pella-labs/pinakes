# Timeout Design

## Timeout Taxonomy

### Connection Timeout
How long to wait for TCP connection establishment. Keep short: 1-3 seconds.

### Request Timeout
How long to wait for a complete response after the connection is established. Set based on expected response time plus headroom.

### Idle Timeout
How long a connection can remain open without activity before being closed.

## Setting Timeout Values

Base timeouts on observed latency distributions:

- p99 latency = 500ms → timeout = 1000-1500ms
- p99 latency = 2s → timeout = 4-5s

Setting timeouts too high wastes resources on hopeless requests. Setting them too low causes false timeouts on legitimate slow requests.

## Timeout Propagation

In microservice architectures, propagate remaining time budget downstream. If a request has 3 seconds remaining when it calls service B, tell service B it has at most 2.5 seconds (reserving 500ms for network overhead and local processing).

```typescript
const deadline = Date.now() + timeoutMs;

async function callDownstream(deadline: number): Promise<Response> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new TimeoutError('deadline exceeded');
  return fetch(url, { signal: AbortSignal.timeout(remaining - 100) });
}
```

## Cascading Timeouts

Without timeout propagation, a slow downstream can cause all upstream services to hold connections waiting. This amplifies a single slow service into system-wide resource exhaustion.

See [[perf-031]] for circuit breakers.
