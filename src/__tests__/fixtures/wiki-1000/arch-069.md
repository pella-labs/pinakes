# Structured Logging

## Why Not Console.log?

Unstructured text logs are impossible to query at scale. **Structured logging** outputs machine-readable records (JSON).

## Example

```typescript
// Bad
console.log(`User ${userId} placed order ${orderId} for $${total}`);

// Good
logger.info({
  event: 'order_placed',
  userId,
  orderId,
  totalCents: total,
  currency: 'USD',
  itemCount: items.length,
});
```

## Log Levels

- **error** — something broke, needs attention
- **warn** — something unexpected, but handled
- **info** — normal operations (request served, job completed)
- **debug** — detailed diagnostic info (disabled in prod)

## Libraries

- **pino** (Node.js) — fast, JSON-native, our choice
- **winston** (Node.js) — flexible, slower
- **structlog** (Python) — composable processors
- **slog** (Go) — stdlib structured logging

## Correlation

Always include `traceId`, `requestId`, and `userId` in log context. Use async local storage to propagate automatically.

See [[monitoring-prometheus]], [[arch-068]].
