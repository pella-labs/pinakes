# Test Databases

Choosing the right database strategy for tests impacts both reliability and speed. Real databases provide confidence; in-memory databases provide speed.

## Strategies

### In-Memory SQLite

Fast but limited. SQLite doesn't support all PostgreSQL features. Good for unit tests, risky for integration tests that use Postgres-specific queries.

### Docker Test Containers

Spin up real database instances in Docker:

```typescript
import { PostgreSqlContainer } from '@testcontainers/postgresql';

let container: StartedPostgreSqlContainer;

beforeAll(async () => {
  container = await new PostgreSqlContainer().start();
  const connectionString = container.getConnectionString();
  db = await connectTo(connectionString);
});

afterAll(async () => {
  await container.stop();
});
```

### Transaction Rollback

Wrap each test in a transaction that rolls back:

```typescript
beforeEach(async () => {
  await db.query('BEGIN');
});

afterEach(async () => {
  await db.query('ROLLBACK');
});
```

This is the fastest approach for real database tests since it avoids recreating the schema.

### Separate Test Schema

Create a dedicated schema per test run. Slower than rollback but avoids transaction scoping issues with connection pools.

## Recommendation

Use transaction rollback for most tests. Use test containers for migration testing and schema verification. Avoid in-memory databases that differ from production. See [[test-002]] for integration test patterns.
