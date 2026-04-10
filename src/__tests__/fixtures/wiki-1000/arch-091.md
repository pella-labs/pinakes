# Idempotent Consumer

## Problem

Message brokers guarantee **at-least-once** delivery. Your consumer might process the same message twice.

## Solution

Make the consumer idempotent: processing the same message twice has the same effect as processing it once.

## Techniques

### Natural Idempotency
`SET status = 'shipped'` is naturally idempotent.

### Deduplication Table

```sql
CREATE TABLE processed_messages (
  message_id VARCHAR(255) PRIMARY KEY,
  processed_at TIMESTAMPTZ DEFAULT NOW()
);

-- In consumer:
BEGIN;
INSERT INTO processed_messages (message_id) VALUES ('msg-123')
  ON CONFLICT DO NOTHING;
-- If insert succeeded (not a duplicate), process the message
-- If insert failed (duplicate), skip
COMMIT;
```

### Conditional Updates
Use optimistic locking:
```sql
UPDATE orders SET status = 'shipped', version = version + 1
WHERE id = 'order-123' AND version = 5;
-- If affected rows = 0, someone else already updated
```

See [[arch-003]], [[arch-035]], [[arch-078]].
