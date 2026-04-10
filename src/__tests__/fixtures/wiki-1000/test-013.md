# Property-Based Testing

**Property-based testing** generates random inputs and verifies that certain properties always hold. Instead of specifying exact input-output pairs, you define invariants.

## The Concept

Traditional test: "sort([3,1,2]) returns [1,2,3]"
Property test: "for any array, sort(arr) returns an array where every element is ≤ the next"

## fast-check for TypeScript

```typescript
import fc from 'fast-check';

test('sort is idempotent', () => {
  fc.assert(
    fc.property(fc.array(fc.integer()), (arr) => {
      const sorted = sort(arr);
      expect(sort(sorted)).toEqual(sorted);
    })
  );
});

test('sort preserves length', () => {
  fc.assert(
    fc.property(fc.array(fc.integer()), (arr) => {
      expect(sort(arr)).toHaveLength(arr.length);
    })
  );
});
```

## Shrinking

When a property test finds a failing input, the framework **shrinks** it to the minimal failing case. If the test fails for `[42, -17, 0, 88, -3]`, shrinking might reduce it to `[1, -1]`.

## When to Use Property-Based Testing

- Serialization/deserialization roundtrips
- Mathematical operations
- Data structure invariants
- Parser robustness
- Codec implementations

Property-based testing excels at finding edge cases humans wouldn't think of. See [[test-001]] for complementary unit testing approaches.

## Choosing Good Properties

The hardest part of property-based testing is identifying useful properties. Here are common patterns that apply across domains:

**Roundtrip properties**: encode then decode returns the original value. This works for serialization, compression, encryption, and parsing.

**Invariant properties**: some condition holds regardless of input. A sorted array's length equals the original length. A balanced BST's height is O(log n).

**Oracle properties**: compare the output against a simpler but known-correct implementation. Test your optimized sort against a naive sort.

**Algebraic properties**: mathematical laws that must hold. Associativity, commutativity, identity elements. If your merge function is supposed to be commutative, test that merge(a, b) equals merge(b, a) for all a and b.

**Metamorphic properties**: changing the input in a known way should change the output in a predictable way. Doubling all elements in an array should double the sum. Adding an element to a sorted array should still produce a sorted array.

These patterns give you a vocabulary for thinking about properties. With practice, identifying the right properties becomes second nature. The effort is front-loaded: once you've written a property test, it runs thousands of cases automatically, each one a potential edge case a human tester would never consider.
