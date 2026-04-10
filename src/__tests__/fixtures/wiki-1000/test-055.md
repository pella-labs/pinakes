# Testing Observability

If your system emits metrics, traces, and logs, test that it does so correctly.

## Metrics Testing

```typescript
it('increments request counter', async () => {
  const metrics = new TestMetricsCollector();
  const handler = createHandler(metrics);

  await handler(req, res);

  expect(metrics.get('http_requests_total')).toBe(1);
  expect(metrics.get('http_request_duration_seconds')).toBeGreaterThan(0);
});
```

## Trace Context Propagation

Verify that trace context is passed through the system:

```typescript
it('propagates trace ID', async () => {
  const traceId = 'abc123';
  const req = createRequest({ headers: { 'x-trace-id': traceId } });

  await handler(req, res);

  expect(res.headers['x-trace-id']).toBe(traceId);
  expect(logCapture.last().traceId).toBe(traceId);
  expect(downstreamCalls[0].headers['x-trace-id']).toBe(traceId);
});
```

## Health Check Endpoints

Test that health endpoints report accurately:

- Healthy when all dependencies are up
- Degraded when optional dependencies are down
- Unhealthy when critical dependencies are down

## Alerting Rules

Test that your alerting conditions fire correctly. If error rate > 5% should page, simulate 6% error rate and verify the alert would trigger.

See [[test-035]] for logging-specific tests and [[test-055]] for metrics patterns.
