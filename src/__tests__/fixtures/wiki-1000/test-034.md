# Testing Configuration

Configuration errors cause a disproportionate number of production incidents. Testing configuration loading, validation, and defaults prevents these.

## What to Test

- Default values are correct
- Environment variables override defaults
- Invalid values are rejected with clear error messages
- Required values fail fast at startup
- Secret values are not logged

```typescript
describe('Config', () => {
  it('uses default port', () => {
    delete process.env.PORT;
    const config = loadConfig();
    expect(config.port).toBe(3000);
  });

  it('reads port from environment', () => {
    process.env.PORT = '8080';
    const config = loadConfig();
    expect(config.port).toBe(8080);
  });

  it('rejects non-numeric port', () => {
    process.env.PORT = 'abc';
    expect(() => loadConfig()).toThrow('PORT must be a number');
  });

  it('requires DATABASE_URL', () => {
    delete process.env.DATABASE_URL;
    expect(() => loadConfig()).toThrow('DATABASE_URL is required');
  });
});
```

## Schema Validation

Use **zod** or **joi** to define a config schema. The schema itself becomes the test specification.

## Environment-Specific Config

Test that production, staging, and development configurations are all valid. Load each profile in tests and verify critical paths.
