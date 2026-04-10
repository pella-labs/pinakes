# Testing with Containers

**Testcontainers** provides lightweight, throwaway instances of databases, message brokers, and other services for testing.

## Basic Usage

```typescript
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer } from '@testcontainers/redis';

describe('with real services', () => {
  let postgres: StartedPostgreSqlContainer;
  let redis: StartedRedisContainer;

  beforeAll(async () => {
    [postgres, redis] = await Promise.all([
      new PostgreSqlContainer().start(),
      new RedisContainer().start(),
    ]);
  }, 60_000);

  afterAll(async () => {
    await Promise.all([postgres.stop(), redis.stop()]);
  });

  it('stores and retrieves from postgres', async () => {
    const db = await connect(postgres.getConnectionString());
    await db.query('CREATE TABLE test (id INT, name TEXT)');
    await db.query("INSERT INTO test VALUES (1, 'hello')");
    const result = await db.query('SELECT name FROM test WHERE id = 1');
    expect(result.rows[0].name).toBe('hello');
  });
});
```

## Custom Containers

Build containers from your own Dockerfiles for testing:

```typescript
const container = await GenericContainer
  .fromDockerfile('./docker', 'custom.Dockerfile')
  .build();
```

## Performance Considerations

Container startup takes seconds. Start containers once per test suite (beforeAll), not per test. Reuse connections across tests and clean up data between tests using transactions.

## CI Integration

Most CI platforms support Docker. Add a Docker-in-Docker service or use the host Docker daemon. Testcontainers detects the CI environment automatically.

See [[test-020]] for test database strategy decisions.
