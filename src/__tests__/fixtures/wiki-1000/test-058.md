# Testing Regex Patterns

Regular expressions are notoriously hard to get right. Testing them with a comprehensive set of inputs prevents subtle bugs.

## Positive and Negative Cases

```typescript
describe('email regex', () => {
  const validEmails = [
    'user@example.com',
    'first.last@domain.org',
    'user+tag@sub.domain.com',
    'digits123@test.io',
  ];

  const invalidEmails = [
    'not-an-email',
    '@missing-local.com',
    'missing-domain@',
    'spaces in@email.com',
    'double@@at.com',
  ];

  validEmails.forEach(email => {
    it(`accepts ${email}`, () => {
      expect(isValidEmail(email)).toBe(true);
    });
  });

  invalidEmails.forEach(email => {
    it(`rejects ${email}`, () => {
      expect(isValidEmail(email)).toBe(false);
    });
  });
});
```

## ReDoS Prevention

**Regular expression denial of service** occurs when a crafted input causes catastrophic backtracking. Test with adversarial inputs:

```typescript
it('does not hang on adversarial input', () => {
  const start = Date.now();
  isValidEmail('a'.repeat(50000) + '@');
  expect(Date.now() - start).toBeLessThan(100); // must complete in < 100ms
});
```

## Boundary Cases

- Empty string
- Single character
- Maximum length strings
- Unicode characters
- Newlines and whitespace
