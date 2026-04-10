# Testing Database Indexes

Indexes improve query performance but have maintenance costs. Test that the right indexes exist and are used.

## Index Existence

```typescript
it('has index on users.email', async () => {
  const indexes = await db.query(`
    SELECT name FROM sqlite_master
    WHERE type = 'index' AND tbl_name = 'users'
  `);
  const indexNames = indexes.map(i => i.name);
  expect(indexNames).toContain('idx_users_email');
});
```

## Query Plan Verification

```typescript
it('uses index for email lookup', async () => {
  const plan = await db.query(
    "EXPLAIN QUERY PLAN SELECT * FROM users WHERE email = 'test@test.com'"
  );
  const detail = plan.map(p => p.detail).join(' ');
  expect(detail).toContain('USING INDEX');
  expect(detail).not.toContain('SCAN');
});
```

## Unique Constraint

```typescript
it('enforces uniqueness on email', async () => {
  await db.insert('users', { email: 'test@test.com', name: 'Alice' });
  await expect(
    db.insert('users', { email: 'test@test.com', name: 'Bob' })
  ).rejects.toThrow(/UNIQUE constraint/);
});
```

## Index Performance

Benchmark queries with and without indexes on realistic data volumes. The improvement should be measurable.

## Composite Indexes

Test that composite indexes support queries on the leading columns. An index on `(a, b, c)` should support queries on `a`, `(a, b)`, and `(a, b, c)` but not `b` alone.
