# Testing Recursive Functions

Recursive functions need tests for base cases, recursive cases, and edge cases like maximum recursion depth.

## Base Cases

```typescript
describe('flatten', () => {
  it('returns empty array for empty input', () => {
    expect(flatten([])).toEqual([]);
  });

  it('returns flat array unchanged', () => {
    expect(flatten([1, 2, 3])).toEqual([1, 2, 3]);
  });
});
```

## Recursive Cases

```typescript
it('flattens nested arrays', () => {
  expect(flatten([1, [2, [3, [4]]]])).toEqual([1, 2, 3, 4]);
});
```

## Stack Overflow Protection

```typescript
it('handles deeply nested input', () => {
  let nested: any = 'leaf';
  for (let i = 0; i < 10000; i++) {
    nested = [nested];
  }

  // Should not throw stack overflow
  expect(() => flatten(nested)).not.toThrow();
});
```

If recursive functions can't handle deep nesting, convert to iterative with an explicit stack and test accordingly.

## Tree Traversal

Recursive tree operations should be tested with various tree shapes: single node, linear chain, balanced tree, and heavily skewed tree.
