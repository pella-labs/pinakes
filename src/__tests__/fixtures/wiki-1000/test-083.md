
# Testing Compiler and Transpiler Output

Compilers transform input into output. Testing them requires verifying that the transformation is correct and preserves semantics.

## Snapshot Testing Compiled Output

```typescript
it('compiles arrow function', () => {
  const input = 'const add = (a, b) => a + b;';
  const output = compile(input, { target: 'es5' });
  expect(output).toMatchInlineSnapshot(`
    "var add = function(a, b) { return a + b; };"
  `);
});
```

## Semantic Preservation

The compiled output must behave identically to the input. Test by running both:

```typescript
it('preserves behavior after compilation', () => {
  const source = 'const result = [1,2,3].map(x => x * 2);';
  const compiled = compile(source, { target: 'es5' });

  const sourceResult = eval(source);
  const compiledResult = eval(compiled);

  expect(compiledResult).toEqual(sourceResult);
});
```

## Error Reporting

Test that compilation errors include line numbers, column numbers, and helpful messages.

## Source Maps

If your transpiler generates source maps, verify that the mapping between source and output positions is correct.

## Performance

Compilation should be fast. Benchmark on realistic file sizes and set regression thresholds.
