# Testing HTTP Client Resilience

HTTP clients must handle the full range of server behaviors: slow responses, connection resets, and malformed data.

## Timeout Handling

```typescript
it('times out after configured duration', async () => {
  nock('https://api.example.com')
    .get('/slow')
    .delay(5000)
    .reply(200);

  const client = createClient({ timeout: 1000 });
  await expect(client.get('/slow')).rejects.toThrow('timeout');
});
```

## Retry Logic

```typescript
it('retries on 503', async () => {
  let attempts = 0;
  nock('https://api.example.com')
    .get('/flaky')
    .times(2)
    .reply(() => {
      attempts++;
      return [503, 'Service Unavailable'];
    })
    .get('/flaky')
    .reply(200, { data: 'ok' });

  const result = await client.get('/flaky');
  expect(result.data).toBe('ok');
  expect(attempts).toBe(2);
});
```

## Connection Errors

Test handling of DNS failures, connection refused, and connection reset errors. Each should produce a clear error message.

## Response Parsing

Test handling of malformed JSON, unexpected content types, and truncated responses. The client should fail gracefully rather than crash.

## Circuit Breaking

After repeated failures, the client should stop making requests for a cooldown period. See [[test-054]] for circuit breaker testing.
