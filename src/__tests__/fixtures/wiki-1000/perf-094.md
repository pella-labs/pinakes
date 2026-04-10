# Observability-Driven Development

## Shift Left on Observability

Don't add monitoring after deployment. Build observability into the development process from the start.

## Observable Code Patterns

### Instrument Business Operations
```typescript
async function processOrder(order: Order): Promise<void> {
  const span = tracer.startSpan('process_order', {
    attributes: { 'order.id': order.id, 'order.total': order.total },
  });

  try {
    metrics.increment('orders.processed');
    await validateOrder(order);
    await chargePayment(order);
    await fulfillOrder(order);
    span.setStatus({ code: SpanStatusCode.OK });
  } catch (error) {
    span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
    metrics.increment('orders.failed', { reason: error.code });
    throw error;
  } finally {
    span.end();
  }
}
```

### Structured Context
Pass context through the call chain. Every log entry and span should include enough context to reconstruct the request flow.

## Testing Observability

Write tests that verify instrumentation:

- Assert that specific metrics are emitted for key operations
- Assert that spans are created with expected attributes
- Assert that error conditions produce appropriate log entries

## Dashboards as Code

Define dashboards in version control (Grafonnet, Terraform) alongside the code they monitor. Deploy dashboard changes with code changes.

See [[perf-017]] for OpenTelemetry and [[perf-019]] for structured logging.
