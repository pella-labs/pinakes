# Testing Authentication and Authorization

Auth testing requires special attention because failures have security implications. Both positive and negative test cases are critical.

## Authentication Tests

```typescript
describe('authentication', () => {
  it('accepts valid credentials', async () => {
    const res = await api.post('/login', {
      email: 'user@test.com',
      password: 'correct-password',
    });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
  });

  it('rejects invalid password', async () => {
    const res = await api.post('/login', {
      email: 'user@test.com',
      password: 'wrong-password',
    });
    expect(res.status).toBe(401);
  });

  it('rejects nonexistent user', async () => {
    const res = await api.post('/login', {
      email: 'nobody@test.com',
      password: 'anything',
    });
    expect(res.status).toBe(401);
    // Should NOT reveal whether email exists
  });
});
```

## Authorization Tests

Test every role against every endpoint:

- Admin can access admin routes
- Regular user cannot access admin routes
- Unauthenticated user cannot access protected routes
- User cannot access another user's resources

## Token Handling

Test token expiration, refresh flows, and revocation. Ensure expired tokens are rejected and refresh tokens generate new valid access tokens.

## Security Edge Cases

- SQL injection in login fields
- Timing attacks on password comparison
- Token leakage in error responses
- CORS configuration
