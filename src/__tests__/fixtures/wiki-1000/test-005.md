# Mocking Strategies

Mocking is essential for isolating units under test, but excessive or poorly designed mocks can make tests brittle and unreliable.

## Types of Test Doubles

Understanding the vocabulary matters:

- **Stub**: Returns predetermined values, no verification
- **Mock**: Verifies that specific calls were made
- **Spy**: Wraps real implementation, records calls
- **Fake**: Working implementation with shortcuts (e.g., in-memory database)
- **Dummy**: Passed around but never used

## When to Mock

Mock external dependencies that are slow, unreliable, or have side effects:

- HTTP APIs
- File system operations
- Date/time functions
- Random number generators
- Payment processors

## When NOT to Mock

Do not mock things you own. If you mock your own repository class, you lose confidence that the real repository works. Use a **fake** instead, or better yet, test against a real database.

```typescript
// Bad: mocking your own code
const mockRepo = { findById: vi.fn().mockResolvedValue(user) };

// Better: use a real in-memory database
const db = createTestDb();
const repo = new UserRepository(db);
```

## Mock Maintenance Burden

Every mock is a maintenance liability. When the mocked interface changes, the mock must change too. If it doesn't, you have a test that passes against a contract that no longer exists. See [[test-001]] and [[test-002]] for alternative approaches.
