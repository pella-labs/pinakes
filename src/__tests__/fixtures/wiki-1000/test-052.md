# Testing DNS and Network Resolution

Network-dependent code needs tests that work offline and handle resolution failures.

## Mocking DNS

```typescript
import dns from 'dns';

it('handles DNS resolution failure', async () => {
  const original = dns.resolve;
  dns.resolve = vi.fn((hostname, callback) => {
    callback(new Error('ENOTFOUND'));
  });

  const result = await checkServiceHealth('api.example.com');
  expect(result.status).toBe('unreachable');

  dns.resolve = original;
});
```

## Testing with Network Isolation

Run tests with network access disabled to ensure they don't make real HTTP calls:

```bash
# On macOS, use network link conditioner
# In CI, use a network namespace
unshare --net vitest run
```

## Certificate Validation

Test that your HTTPS client correctly rejects invalid certificates in production mode and allows them in development mode. This prevents both security vulnerabilities and development friction.

## Proxy Support

If your application supports HTTP proxies, test that requests are correctly routed through the proxy and that proxy authentication works.
