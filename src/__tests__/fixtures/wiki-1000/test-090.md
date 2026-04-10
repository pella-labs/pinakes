---
title: Testing OAuth Flows
tags: [testing, oauth, authentication]
created: 2025-12-10
---

# Testing OAuth Flows

OAuth involves multiple redirects and external providers. Testing requires careful mocking of the provider's behavior.

## Authorization Code Flow

```typescript
it('exchanges code for token', async () => {
  // Mock the provider's token endpoint
  nock('https://oauth.provider.com')
    .post('/token')
    .reply(200, {
      access_token: 'test-token',
      token_type: 'bearer',
      expires_in: 3600,
    });

  const result = await exchangeCode('auth-code-123');
  expect(result.accessToken).toBe('test-token');
});
```

## Callback Handling

```typescript
it('handles OAuth callback', async () => {
  const res = await request(app)
    .get('/auth/callback?code=abc&state=xyz');

  expect(res.status).toBe(302);
  expect(res.headers.location).toBe('/dashboard');
});

it('rejects callback with mismatched state', async () => {
  const res = await request(app)
    .get('/auth/callback?code=abc&state=wrong');

  expect(res.status).toBe(403);
});
```

## Token Refresh

Test that expired tokens are automatically refreshed before API calls. The user should never see an auth error due to token expiration.

## Provider Errors

Test handling of various provider error responses: invalid_grant, invalid_client, and server_error.

## Scope Verification

Test that the application requests the minimum necessary scopes and handles scope downgrades gracefully.

See [[test-033]] for broader authentication testing.
