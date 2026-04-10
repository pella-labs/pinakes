# Testing Error Messages

Error messages are part of the user experience. They should be clear, actionable, and accurate.

## Message Content

```typescript
it('includes the problematic value in error', () => {
  expect(() => validatePort('abc')).toThrow(
    "Invalid port: 'abc'. Must be a number between 1 and 65535."
  );
});
```

## Actionable Guidance

```typescript
it('suggests fix in error message', () => {
  expect(() => loadConfig()).toThrow(
    /DATABASE_URL is required\. Set it in \.env or as an environment variable\./
  );
});
```

## Error Codes

```typescript
it('includes error code for programmatic handling', () => {
  try {
    await api.createUser({ email: 'taken@test.com' });
  } catch (e) {
    expect(e.code).toBe('USER_EMAIL_TAKEN');
    expect(e.message).toContain('already registered');
  }
});
```

## Localization

If errors are user-facing, test that they're translatable:

```typescript
it('returns localized error', () => {
  setLocale('de');
  expect(() => validate({})).toThrow('E-Mail ist erforderlich');
});
```

## Sensitive Data Exclusion

Error messages must not include passwords, tokens, or internal paths:

```typescript
it('does not leak internal paths', () => {
  try {
    await readConfig('/etc/app/secret.yml');
  } catch (e) {
    expect(e.message).not.toContain('/etc/app');
    expect(e.message).toContain('Configuration file not found');
  }
});
```
