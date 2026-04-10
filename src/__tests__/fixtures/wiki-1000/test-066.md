# Testing Input Validation

Input validation is the first line of defense. Every public API surface needs thorough validation tests.

## Schema Validation with Zod

```typescript
import { z } from 'zod';

const userSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  age: z.number().int().min(0).max(150),
});

describe('user input validation', () => {
  it('accepts valid input', () => {
    const result = userSchema.safeParse({
      name: 'Alice',
      email: 'alice@example.com',
      age: 30,
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing required fields', () => {
    const result = userSchema.safeParse({ name: 'Alice' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid email', () => {
    const result = userSchema.safeParse({
      name: 'Alice',
      email: 'not-an-email',
      age: 30,
    });
    expect(result.success).toBe(false);
  });
});
```

## Boundary Values

Test at the edges of valid ranges:

- Minimum and maximum string lengths
- Zero, negative, and maximum numbers
- Empty arrays and maximum-length arrays

## Sanitization

Test that input is sanitized before use. Whitespace trimming, HTML escaping, and null byte removal should all be verified.

See [[test-057]] for security-focused validation testing.
