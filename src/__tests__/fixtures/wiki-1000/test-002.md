---
title: Integration Testing Strategies
tags: [testing, integration, databases]
created: 2025-11-15
---

# Integration Testing Strategies

**Integration tests** verify that multiple components work together correctly. Unlike unit tests, they exercise real interactions between modules, databases, and external services.

## When to Write Integration Tests

Integration tests fill the gap between unit tests and end-to-end tests. Write them when:

- A bug could hide in the boundary between two modules
- Database queries need verification against real schema
- API contracts must be validated
- Message queue consumers need to handle real message formats

## Database Integration Tests

The most common integration test pattern involves a real database. Using an in-memory SQLite instance or a test-specific PostgreSQL schema gives confidence that queries actually work.

```typescript
describe('UserRepository', () => {
  let db: Database;

  beforeEach(async () => {
    db = await createTestDatabase();
    await runMigrations(db);
  });

  afterEach(async () => {
    await db.close();
  });

  it('finds users by email', async () => {
    await db.insert('users', { email: 'test@example.com', name: 'Test' });
    const user = await userRepo.findByEmail(db, 'test@example.com');
    expect(user?.name).toBe('Test');
  });
});
```

## Balancing Speed and Confidence

Integration tests are slower than unit tests but faster than e2e tests. A healthy test suite follows the **testing pyramid**: many unit tests, fewer integration tests, even fewer e2e tests. See [[test-003]] for e2e testing patterns and [[test-001]] for unit testing fundamentals.
