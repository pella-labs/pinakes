
# Testing Security Vulnerabilities

Security testing should be part of the regular test suite, not a separate activity performed occasionally.

## SQL Injection

```typescript
it('prevents SQL injection in search', async () => {
  const malicious = "'; DROP TABLE users; --";
  const results = await search(malicious);
  // Should return empty results, not crash
  expect(results).toEqual([]);

  // Verify table still exists
  const users = await db.query('SELECT COUNT(*) FROM users');
  expect(users[0].count).toBeGreaterThan(0);
});
```

## XSS Prevention

```typescript
it('escapes HTML in user content', () => {
  const input = '<script>alert("xss")</script>';
  const rendered = renderComment(input);
  expect(rendered).not.toContain('<script>');
  expect(rendered).toContain('&lt;script&gt;');
});
```

## Path Traversal

```typescript
it('prevents path traversal', async () => {
  const result = await readFile('../../etc/passwd');
  expect(result.error).toBe('Invalid path');
});
```

## CSRF Protection

Test that state-changing requests require a valid CSRF token and reject requests without one.

## Dependency Scanning

Run `npm audit` in CI. Fail the build on high-severity vulnerabilities. This catches known CVEs in your dependency tree.

## OWASP Top 10

Systematically test for each category in the OWASP Top 10. Automated tools catch some issues; manual testing catches the rest. See [[test-033]] for auth-specific security testing.
