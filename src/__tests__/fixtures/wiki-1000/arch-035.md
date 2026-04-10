# Idempotency in Distributed Systems

## Why It Matters

Network failures, retries, and duplicate messages are inevitable. If your operations aren't **idempotent**, you'll process the same action multiple times.

## Strategies

### Natural Idempotency
Some operations are naturally idempotent: `SET x = 5`, `DELETE WHERE id = 123`. These are safe to retry.

### Idempotency Keys
For non-idempotent operations, require clients to send a unique key. Store the key and result; on duplicate, return the stored result.

```typescript
async function processPayment(idempotencyKey: string, amount: number) {
  const existing = await db.query(
    'SELECT result FROM idempotency_keys WHERE key = ?',
    [idempotencyKey]
  );
  if (existing) return existing.result;

  const result = await paymentGateway.charge(amount);

  await db.query(
    'INSERT INTO idempotency_keys (key, result, expires_at) VALUES (?, ?, ?)',
    [idempotencyKey, result, Date.now() + 86400000]
  );

  return result;
}
```

### Optimistic Locking
Use version numbers to detect concurrent modifications.

## Cleanup

Idempotency keys have a TTL. Clean up expired keys periodically.

See [[api-rest-design]], [[arch-016]], [[arch-015]].
