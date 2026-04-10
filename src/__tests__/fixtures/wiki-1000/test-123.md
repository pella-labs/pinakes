# Testing Distributed Tracing

**Distributed tracing** tracks requests across service boundaries. Testing ensures trace context propagates correctly.

## Trace ID Propagation

```typescript
it('propagates trace ID to downstream services', async () => {
  const traceId = generateTraceId();

  const response = await request(app)
    .get('/api/data')
    .set('traceparent', `00-${traceId}-${generateSpanId()}-01`);

  // Verify downstream service received the trace ID
  expect(mockDownstream.lastRequest.headers.traceparent).toContain(traceId);
});
```

## Span Creation

```typescript
it('creates spans for each operation', async () => {
  const spans = captureSpans(async () => {
    await handleRequest(testRequest);
  });

  expect(spans).toContainEqual(expect.objectContaining({ name: 'http.request' }));
  expect(spans).toContainEqual(expect.objectContaining({ name: 'db.query' }));
  expect(spans).toContainEqual(expect.objectContaining({ name: 'cache.lookup' }));
});
```

## Parent-Child Relationships

```typescript
it('maintains parent-child span relationships', async () => {
  const spans = await captureSpans(() => handleRequest(req));
  const httpSpan = spans.find(s => s.name === 'http.request');
  const dbSpan = spans.find(s => s.name === 'db.query');

  expect(dbSpan.parentSpanId).toBe(httpSpan.spanId);
  expect(dbSpan.traceId).toBe(httpSpan.traceId);
});
```

## Error Tagging

Test that spans for failed operations include error tags and status codes.

See [[test-055]] for broader observability testing.
