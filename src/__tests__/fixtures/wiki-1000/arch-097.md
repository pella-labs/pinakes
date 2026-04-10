# Error Handling in Distributed Systems

## Types of Errors

### Transient
Network timeouts, temporary unavailability. **Retry with backoff.**

### Permanent
Invalid input, business rule violation. **Don't retry. Return error to caller.**

### Unknown
Ambiguous failures (timeout during write — did it succeed?). **Check before retry.**

## Error Propagation

```typescript
// Don't leak internal errors to clients
class OrderController {
  async createOrder(req: Request, res: Response) {
    try {
      const result = await this.useCase.execute(req.body);
      return res.status(201).json(result);
    } catch (err) {
      if (err instanceof ValidationError) {
        return res.status(400).json({ error: err.message });
      }
      if (err instanceof NotFoundError) {
        return res.status(404).json({ error: 'Order not found' });
      }
      logger.error('Unexpected error', { err, requestId: req.id });
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
}
```

## Error Types

Define error types for your domain:
- `NotFoundError`
- `ConflictError` (optimistic lock failure)
- `ValidationError`
- `AuthorizationError`
- `ExternalServiceError`

See [[arch-015]], [[arch-014]], [[api-rest-design]].
