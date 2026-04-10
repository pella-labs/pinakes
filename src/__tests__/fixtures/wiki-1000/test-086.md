---
title: Testing Code Generation
tags: [testing, codegen, templates]
---

# Testing Code Generation

Code generators produce source code from schemas, templates, or ASTs. Testing them ensures the output is correct and compilable.

## Output Compilation

The minimum test: generated code must compile without errors:

```typescript
it('generates valid TypeScript', async () => {
  const generated = await generateTypes(schema);
  const diagnostics = compileTsString(generated);
  expect(diagnostics).toHaveLength(0);
});
```

## Snapshot Tests for Generated Code

```typescript
it('generates expected type definitions', async () => {
  const generated = await generateTypes(userSchema);
  expect(generated).toMatchInlineSnapshot(`
    "export interface User {
      id: string;
      name: string;
      email: string;
      createdAt: Date;
    }"
  `);
});
```

## Behavioral Tests

Don't just test the generated text; test its behavior:

```typescript
it('generated validator rejects invalid input', async () => {
  const validatorCode = await generateValidator(schema);
  const validator = evalModule(validatorCode);
  expect(validator({ name: '' })).toEqual({
    valid: false,
    errors: [{ field: 'name', message: 'required' }],
  });
});
```

## Idempotency

Running the generator twice with the same input should produce identical output. Timestamp-based or random elements break this.

## Edge Cases

Test with schemas that have no fields, deeply nested types, circular references, and reserved keywords as field names.
