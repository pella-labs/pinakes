
# Testing Serialization and Deserialization

Serialization bugs cause data loss and corruption. Roundtrip testing is the most effective defense.

## Roundtrip Tests

The most important serialization test: serialize then deserialize and compare:

```typescript
it('roundtrips user data', () => {
  const original: User = {
    id: 1,
    name: 'Alice',
    createdAt: new Date('2025-01-15'),
    preferences: { theme: 'dark', notifications: true },
  };

  const serialized = serialize(original);
  const deserialized = deserialize(serialized);

  expect(deserialized).toEqual(original);
});
```

## Edge Cases

- Date objects (JSON.stringify loses the type)
- undefined vs null
- BigInt values
- Circular references
- Special floating point values (NaN, Infinity)
- Binary data (Buffer, ArrayBuffer)
- Empty strings vs missing fields

## Backward Compatibility

When the serialization format changes, test that old data can still be deserialized:

```typescript
it('deserializes v1 format', () => {
  const v1Data = '{"name":"Alice","type":"admin"}';
  const result = deserialize(v1Data);
  expect(result.name).toBe('Alice');
  expect(result.role).toBe('admin'); // renamed field
});
```

## Property-Based Roundtrip

Use [[test-013]] property-based testing for thorough roundtrip verification across random inputs.
