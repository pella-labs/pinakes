# Testing API Versioning

API versioning ensures backward compatibility. Testing prevents breaking changes from affecting existing clients.

## Version Routing

```typescript
it('routes to v1 handler', async () => {
  const res = await request(app).get('/api/v1/users');
  expect(res.body.format).toBe('v1');
});

it('routes to v2 handler', async () => {
  const res = await request(app).get('/api/v2/users');
  expect(res.body.format).toBe('v2');
});
```

## Backward Compatibility

Test that v1 responses maintain their shape even after v2 is released:

```typescript
it('v1 response shape is unchanged', async () => {
  const res = await request(app).get('/api/v1/users/1');
  expect(res.body).toHaveProperty('name');
  expect(res.body).toHaveProperty('email');
  expect(res.body).not.toHaveProperty('profile'); // added in v2
});
```

## Version Negotiation

If using header-based versioning, test that the correct version is selected:

```typescript
it('uses version from Accept header', async () => {
  const res = await request(app)
    .get('/api/users')
    .set('Accept', 'application/vnd.myapp.v2+json');
  expect(res.body.version).toBe('v2');
});
```

## Deprecation Warnings

Test that deprecated endpoints return appropriate warning headers.
