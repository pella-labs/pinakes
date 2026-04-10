
# Testing Graceful Shutdown

A graceful shutdown completes in-progress work before terminating. Testing it prevents data loss during deployments.

## Signal Handling

```typescript
it('handles SIGTERM gracefully', async () => {
  const server = await startServer();

  // Start a long-running request
  const requestPromise = fetch(`http://localhost:${server.port}/slow`);

  // Send SIGTERM
  process.kill(server.pid, 'SIGTERM');

  // Request should complete successfully
  const response = await requestPromise;
  expect(response.status).toBe(200);
});
```

## Connection Draining

Test that the server stops accepting new connections while finishing existing ones:

```typescript
it('rejects new connections during shutdown', async () => {
  const server = await startServer();
  server.beginShutdown();

  // Existing connections should complete
  expect(await existingRequest).toBe(200);

  // New connections should be rejected
  await expect(fetch(server.url)).rejects.toThrow();
});
```

## Shutdown Timeout

If in-progress work doesn't complete within a timeout, the server should force-terminate:

```typescript
it('force-terminates after timeout', async () => {
  const server = await startServer({ shutdownTimeout: 1000 });
  // Start a request that takes 5 seconds
  const req = fetch(`${server.url}/very-slow`);

  server.beginShutdown();

  // Should terminate within 2 seconds (1s timeout + buffer)
  const start = Date.now();
  await server.waitForExit();
  expect(Date.now() - start).toBeLessThan(2000);
});
```

## Background Task Completion

Test that background tasks (cron jobs, queue consumers) finish their current work before the process exits.
