---
title: Test Fixtures and Data Management
tags: [testing, fixtures, data]
---

# Test Fixtures and Data Management

**Test fixtures** provide consistent, reusable data for test cases. Managing them well is the difference between a maintainable and an unmaintainable test suite.

## Fixture Approaches

### Static Fixtures

JSON or YAML files with predefined data:

```json
{
  "users": [
    { "id": 1, "name": "Alice", "role": "admin" },
    { "id": 2, "name": "Bob", "role": "viewer" }
  ]
}
```

### Factory Functions

Generate data programmatically with sensible defaults:

```typescript
function createUser(overrides: Partial<User> = {}): User {
  return {
    id: nextId(),
    name: 'Test User',
    email: `user-${nextId()}@test.com`,
    role: 'viewer',
    ...overrides,
  };
}
```

### Builder Pattern

For complex objects with many optional fields:

```typescript
const user = UserBuilder.create()
  .withRole('admin')
  .withEmail('admin@test.com')
  .build();
```

## Database Fixtures

For integration tests, seed the database before each test. Use transactions that roll back after each test to keep the database clean. This is faster than dropping and recreating tables.

## Fixture Libraries

- **Fishery** — TypeScript factory library
- **FactoryBot** — Ruby standard (inspiration for many JS ports)
- **@mswjs/data** — in-memory relational data for mocking

See [[test-002]] for how fixtures integrate with integration tests.
