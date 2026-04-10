# Testing Data Pipelines

Data pipelines transform, aggregate, and move data between systems. Testing them requires verifying both correctness and performance.

## Testing Transformations

Each transformation step should be a pure function that can be tested independently:

```typescript
it('normalizes phone numbers', () => {
  expect(normalizePhone('+1 (555) 123-4567')).toBe('+15551234567');
  expect(normalizePhone('555.123.4567')).toBe('+15551234567');
  expect(normalizePhone('invalid')).toBeNull();
});

it('deduplicates records by email', () => {
  const input = [
    { email: 'a@b.com', name: 'Alice' },
    { email: 'a@b.com', name: 'Alice B' },
    { email: 'c@d.com', name: 'Carol' },
  ];
  const result = deduplicate(input, 'email');
  expect(result).toHaveLength(2);
});
```

## Testing Full Pipeline

Run the entire pipeline against a known input dataset and compare the output:

```typescript
it('processes daily extract correctly', async () => {
  const input = loadFixture('2025-01-15-extract.csv');
  const expected = loadFixture('2025-01-15-expected.json');

  const result = await pipeline.run(input);
  expect(result).toEqual(expected);
});
```

## Data Quality Assertions

Beyond correctness, test data quality:

- No null values in required fields
- Referential integrity between tables
- Value ranges are within expected bounds
- Row counts match expected ratios

## Idempotency

Run the pipeline twice with the same input. The output should be identical. This ensures safe retries after failures.
