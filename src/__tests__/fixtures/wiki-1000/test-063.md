# Testing Database Transactions

**Transaction** correctness is critical for data integrity. Test isolation levels, rollback behavior, and deadlock handling.

## Atomicity

```typescript
it('rolls back all changes on error', async () => {
  const initialBalance = await getBalance(account.id);

  try {
    await db.transaction(async (tx) => {
      await tx.update('accounts', { balance: 0 }, { id: account.id });
      throw new Error('simulated failure');
    });
  } catch (e) {
    // expected
  }

  const currentBalance = await getBalance(account.id);
  expect(currentBalance).toBe(initialBalance);
});
```

## Isolation

Test that concurrent transactions don't see each other's uncommitted changes:

```typescript
it('prevents dirty reads', async () => {
  const tx1 = await db.beginTransaction();
  await tx1.update('accounts', { balance: 0 }, { id: 1 });

  // tx2 should see the original balance
  const balance = await db.query('SELECT balance FROM accounts WHERE id = 1');
  expect(balance[0].balance).toBe(100); // original value

  await tx1.rollback();
});
```

## Nested Transactions

Test savepoint behavior when transactions are nested. A rollback to a savepoint should not affect the outer transaction.

## Long-Running Transactions

Test that long-running transactions don't cause lock contention issues. Use timeouts to detect transactions that run too long.

See [[test-039]] for concurrency testing and [[test-020]] for test database strategies.
