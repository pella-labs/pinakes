# Testing Content Security Policies

A **Content Security Policy** (CSP) defines which resources a page can load. Testing it prevents both security regressions and broken functionality.

## CSP Header Verification

```typescript
it('sets strict CSP header', async () => {
  const res = await request(app).get('/');
  const csp = res.headers['content-security-policy'];

  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("script-src 'self'");
  expect(csp).not.toContain("'unsafe-inline'");
  expect(csp).not.toContain("'unsafe-eval'");
});
```

## Report-Only Testing

Deploy new CSP rules in report-only mode first. Collect violations and fix them before enforcing.

## Testing in Browser

CSP enforcement happens in the browser, not in Node.js tests. Use Playwright to verify that CSP violations are not thrown during normal page usage:

```typescript
test('no CSP violations on homepage', async ({ page }) => {
  const violations: string[] = [];
  page.on('console', msg => {
    if (msg.text().includes('Content Security Policy')) {
      violations.push(msg.text());
    }
  });

  await page.goto('/');
  expect(violations).toHaveLength(0);
});
```

## Inline Script Handling

If you use inline scripts, test that they have correct nonce attributes that match the CSP header.
