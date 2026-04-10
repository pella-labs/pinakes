# Testing CSV Parsing

CSV seems simple but has surprisingly many edge cases. Robust parsing requires thorough testing.

## Basic Parsing

```typescript
it('parses simple CSV', () => {
  const csv = 'name,age\nAlice,30\nBob,25';
  const result = parseCSV(csv);
  expect(result).toEqual([
    { name: 'Alice', age: '30' },
    { name: 'Bob', age: '25' },
  ]);
});
```

## Quoted Fields

```typescript
it('handles quoted fields', () => {
  const csv = 'name,bio\nAlice,"Likes coding, hiking"';
  const result = parseCSV(csv);
  expect(result[0].bio).toBe('Likes coding, hiking');
});

it('handles quotes within quotes', () => {
  const csv = 'name,quote\nAlice,"She said ""hello"""';
  const result = parseCSV(csv);
  expect(result[0].quote).toBe('She said "hello"');
});
```

## Edge Cases

- Empty fields: `a,,c`
- Newlines inside quoted fields
- Trailing newline
- BOM (byte order mark) at start
- Different delimiters (semicolon, tab)
- Very long fields (>1MB)
- Empty file
- Header-only file (no data rows)

## Streaming Large Files

For files too large to fit in memory, test the streaming parser:

```typescript
it('streams large CSV files', async () => {
  let rowCount = 0;
  await parseCSVStream('large.csv', () => { rowCount++; });
  expect(rowCount).toBe(1_000_000);
});
```
