# Testing Logging

Logging is observable behavior. If your system is supposed to log certain events, test that it does.

## Capturing Log Output

Inject a test logger or capture stdout:

```typescript
import { createLogger } from '../logger';

it('logs request details', async () => {
  const logs: string[] = [];
  const logger = createLogger({
    write: (msg) => logs.push(msg),
  });

  await handleRequest(req, res, logger);

  expect(logs).toContainEqual(
    expect.stringContaining('GET /api/users')
  );
});
```

## What to Test in Logging

- Critical operations are logged (authentication, payments, errors)
- Log level is appropriate (errors are ERROR, routine ops are INFO)
- Sensitive data is NOT logged (passwords, tokens, PII)
- Structured log fields are present (request ID, user ID, timestamp)

## Sensitive Data Checks

```typescript
it('does not log passwords', async () => {
  const logs: string[] = [];
  const logger = captureLogger(logs);

  await handleLogin({ email: 'test@test.com', password: 'secret123' }, logger);

  const allLogs = logs.join('\n');
  expect(allLogs).not.toContain('secret123');
});
```

## Log Format Verification

If downstream systems parse your logs, test the format. A JSON log that's missing a field will break log aggregation silently.
