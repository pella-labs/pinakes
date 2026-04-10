# Testing Data Migrations

When data formats change, migration code transforms existing data. Testing prevents data loss or corruption.

## Forward Migration

```typescript
it('migrates v1 to v2 format', () => {
  const v1Data = {
    name: 'Alice',
    address: '123 Main St, Springfield, IL 62701',
  };

  const v2Data = migrateV1ToV2(v1Data);
  expect(v2Data).toEqual({
    name: 'Alice',
    address: {
      street: '123 Main St',
      city: 'Springfield',
      state: 'IL',
      zip: '62701',
    },
  });
});
```

## Backward Migration

Test that data can be migrated back to the previous format if needed:

```typescript
it('v2 to v1 migration is lossless', () => {
  const original = { name: 'Alice', address: '123 Main St, Springfield, IL 62701' };
  const migrated = migrateV1ToV2(original);
  const restored = migrateV2ToV1(migrated);
  expect(restored).toEqual(original);
});
```

## Edge Cases in Production Data

Test with data that has:
- Missing optional fields
- Extra unexpected fields
- Null values where not expected
- Maximum length strings
- Special characters in all fields

## Batch Migration Performance

If migrating millions of records, test that the migration completes in a reasonable time and uses bounded memory.

See [[test-028]] for database migration testing.
