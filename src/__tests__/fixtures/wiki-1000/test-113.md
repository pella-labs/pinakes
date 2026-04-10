---
title: Testing Token-Based Authentication
tags: [testing, jwt, authentication]
---

# Testing Token-Based Authentication

JWT and similar token-based auth systems have specific testing requirements around encoding, expiration, and claims.

## Token Generation

```typescript
it('generates valid JWT', () => {
  const token = generateToken({ userId: '1', role: 'admin' });
  const decoded = jwt.verify(token, SECRET);

  expect(decoded.userId).toBe('1');
  expect(decoded.role).toBe('admin');
  expect(decoded.exp).toBeDefined();
});
```

## Token Expiration

```typescript
it('rejects expired token', () => {
  const token = generateToken({ userId: '1' }, { expiresIn: '1s' });

  vi.advanceTimersByTime(2000);

  expect(() => verifyToken(token)).toThrow('Token expired');
});
```

## Token Claims Validation

```typescript
it('rejects token with wrong issuer', () => {
  const token = jwt.sign({ userId: '1' }, SECRET, { issuer: 'wrong-app' });
  expect(() => verifyToken(token, { issuer: 'my-app' })).toThrow();
});
```

## Token Refresh

```typescript
it('refreshes token before expiration', async () => {
  const original = generateToken({ userId: '1' }, { expiresIn: '5m' });

  vi.advanceTimersByTime(4 * 60 * 1000); // 4 minutes

  const refreshed = await refreshToken(original);
  const decoded = verifyToken(refreshed);
  expect(decoded.userId).toBe('1');
  expect(decoded.exp).toBeGreaterThan(Date.now() / 1000 + 240);
});
```

## Algorithm Confusion

Test that the server rejects tokens signed with unexpected algorithms (e.g., `none` algorithm attack).

See [[test-033]] and [[test-090]] for broader auth testing.
