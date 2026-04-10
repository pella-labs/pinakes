# Testing Sorting and Filtering

Sorting and filtering are fundamental operations that appear everywhere. Edge cases abound.

## Sort Stability

```typescript
it('preserves order of equal elements', () => {
  const items = [
    { name: 'Alice', age: 30 },
    { name: 'Bob', age: 30 },
    { name: 'Carol', age: 25 },
  ];

  const sorted = sortBy(items, 'age');
  const thirtyYearOlds = sorted.filter(i => i.age === 30);
  expect(thirtyYearOlds[0].name).toBe('Alice'); // original order preserved
  expect(thirtyYearOlds[1].name).toBe('Bob');
});
```

## Multi-Field Sort

```typescript
it('sorts by multiple fields', () => {
  const sorted = sortBy(items, ['department', '-salary']);
  // Within each department, highest salary first
});
```

## Filter Edge Cases

- Filter returns empty results
- Filter with no criteria returns all results
- Filter with contradictory criteria returns empty
- Case sensitivity in string filters
- Null values in filtered fields

## Combined Sort and Filter

Test that sorting applies after filtering, not before. The sort should operate on the filtered subset, not the full dataset.

## Pagination with Sort

Verify that sorting is consistent across pages. If sorting by name, page 2 should start where page 1 ended, with no duplicates or gaps. See [[test-044]] for pagination testing.
