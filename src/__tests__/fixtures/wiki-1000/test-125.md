---
title: Test Environment Management
tags: [testing, environment, devops]
created: 2025-12-15
---

# Test Environment Management

Managing test environments is as important as writing the tests themselves. A flaky environment produces flaky tests.

## Environment Isolation

Each test run should be isolated from others. Shared state between test runs causes intermittent failures.

Strategies for isolation:
- Unique database per test suite
- Unique port numbers per parallel run
- Unique temp directories per test
- Container-per-suite with Testcontainers

## Environment Variables

```typescript
describe('test env management', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('sets test-specific env vars', () => {
    process.env.API_URL = 'http://localhost:4000';
    const config = loadConfig();
    expect(config.apiUrl).toBe('http://localhost:4000');
  });
});
```

## Seed Data Management

Maintain versioned seed data that evolves with the schema. When migrations change the schema, update the seed data to match.

## Cleanup

Always clean up after tests. Leaked resources (processes, containers, temp files) accumulate and cause issues in CI.

```typescript
afterAll(async () => {
  await stopAllContainers();
  await cleanTempDirs();
  await closeAllConnections();
});
```

## CI-Specific Considerations

CI environments differ from local development:
- Less memory and CPU
- No GUI (headless browsers only)
- Different file system performance
- Network restrictions

Test locally with CI-like constraints using Docker to catch environment-specific bugs before they reach CI.

See [[test-019]] for CI pipeline design, [[test-085]] for container-based testing, and [[test-014]] for flaky test elimination.
