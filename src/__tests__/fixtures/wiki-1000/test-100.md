# Testing Type Safety

In TypeScript, compile-time types can diverge from runtime behavior. Testing both ensures the type system and runtime agree.

## Type-Level Tests

Use `expectTypeOf` from vitest to test types:

```typescript
import { expectTypeOf } from 'vitest';

it('returns correct type', () => {
  const result = parseConfig('{}');
  expectTypeOf(result).toMatchTypeOf<Config>();
});

it('requires all fields', () => {
  // @ts-expect-error - missing required field
  createUser({ name: 'Alice' });
});
```

## Runtime Type Checking

Even with TypeScript, data from external sources can be any shape. Test that runtime validation catches type mismatches:

```typescript
it('rejects wrong types at runtime', () => {
  expect(() => processUser({ name: 42 } as any)).toThrow('name must be a string');
});
```

## Generic Function Testing

Test generic functions with multiple type arguments:

```typescript
it('works with different types', () => {
  expect(identity(42)).toBe(42);
  expect(identity('hello')).toBe('hello');
  expect(identity(null)).toBeNull();
});
```

## Type Narrowing

Test that type guards work correctly at runtime:

```typescript
it('narrows union types', () => {
  const value: string | number = getInput();
  if (isString(value)) {
    expect(typeof value).toBe('string');
  } else {
    expect(typeof value).toBe('number');
  }
});
```

See [[test-053]] for serialization where type safety is especially important.
