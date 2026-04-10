# Optimistic vs Pessimistic Concurrency

## Pessimistic Locking

Acquire a lock before reading, hold it through the write. Guarantees no conflicts but reduces concurrency.

```sql
-- Pessimistic: lock the row
SELECT * FROM accounts WHERE id = 1 FOR UPDATE;
UPDATE accounts SET balance = balance - 100 WHERE id = 1;
COMMIT;
```

## Optimistic Locking

Read without locking. On write, check if the data changed since the read. If so, retry.

```sql
-- Optimistic: use version column
SELECT balance, version FROM accounts WHERE id = 1;
-- Application computes new balance
UPDATE accounts SET balance = 900, version = version + 1
WHERE id = 1 AND version = 42;
-- If 0 rows updated, someone else changed it; retry
```

## When to Use Which

**Pessimistic** is better when:
- Conflicts are frequent
- Retries are expensive
- You need to guarantee forward progress

**Optimistic** is better when:
- Conflicts are rare
- Reads far outnumber writes
- You can tolerate occasional retries

## Hybrid Approach

Start optimistic. If retry rate exceeds a threshold (e.g., 5%), switch to pessimistic for that resource. Monitor the conflict rate and adapt.

See [[perf-088]] for lock contention and [[perf-105]] for distributed locks.
