# Testing Environment Parity

Differences between development, staging, and production environments cause bugs that only appear in production.

## Configuration Parity

Test that all environments have the required configuration:

```typescript
const requiredEnvVars = [
  'DATABASE_URL',
  'REDIS_URL',
  'API_SECRET',
  'SMTP_HOST',
];

describe('environment configuration', () => {
  requiredEnvVars.forEach(varName => {
    it(`${varName} is set`, () => {
      expect(process.env[varName]).toBeDefined();
      expect(process.env[varName]).not.toBe('');
    });
  });
});
```

## Docker Compose for Local Parity

Use Docker Compose to run the same services locally as in production. This catches issues like version mismatches between local and production databases.

## Smoke Tests

Run a minimal set of tests against each environment after deployment:

- Can the app start?
- Can it connect to the database?
- Can it authenticate with external services?
- Do critical API endpoints respond?

## Infrastructure Drift

Use tools like **Terratest** or **InSpec** to verify that actual infrastructure matches the expected configuration. Infrastructure drift causes the kind of bugs that are impossible to reproduce locally.
