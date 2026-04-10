# Testing URL Routing

URL routing determines which handler processes each request. Testing it prevents 404 errors and security bypasses.

## Route Matching

```typescript
describe('router', () => {
  it('matches static routes', () => {
    const handler = router.match('GET', '/api/users');
    expect(handler).toBeDefined();
  });

  it('matches parameterized routes', () => {
    const { handler, params } = router.match('GET', '/api/users/123');
    expect(handler).toBeDefined();
    expect(params.id).toBe('123');
  });

  it('returns 404 for unknown routes', () => {
    const handler = router.match('GET', '/api/nonexistent');
    expect(handler).toBeNull();
  });

  it('returns 405 for wrong method', () => {
    const handler = router.match('DELETE', '/api/users');
    expect(handler).toBeNull();
  });
});
```

## Route Priority

Test that more specific routes take priority over wildcards:

```typescript
it('prefers exact match over wildcard', () => {
  const handler = router.match('GET', '/api/users/me');
  expect(handler.name).toBe('getCurrentUser'); // not getUser(:id)
});
```

## Trailing Slashes

Test that `/api/users` and `/api/users/` are handled consistently.

## Query Parameters

Verify that query parameters are parsed correctly and don't affect route matching.
