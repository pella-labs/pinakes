# Testing Text Processing

Text processing functions handle encoding, normalization, and transformation. Edge cases in Unicode make thorough testing essential.

## Normalization

```typescript
it('normalizes Unicode', () => {
  const nfd = 'caf\u0065\u0301'; // 'e' + combining accent
  const nfc = 'caf\u00e9';       // precomposed e-acute
  expect(normalize(nfd)).toBe(normalize(nfc));
});
```

## Truncation

```typescript
it('truncates at word boundary', () => {
  const text = 'The quick brown fox jumps over the lazy dog';
  const truncated = truncateWords(text, 20);
  expect(truncated).toBe('The quick brown fox...');
  expect(truncated.length).toBeLessThanOrEqual(23);
});
```

## Encoding Detection

```typescript
it('detects UTF-8 encoding', () => {
  const buffer = Buffer.from('Hello, 世界');
  expect(detectEncoding(buffer)).toBe('utf-8');
});
```

## Line Ending Handling

Test with different line endings: `\n` (Unix), `\r\n` (Windows), `\r` (old Mac). Many text processing bugs come from assuming one format.

## Empty and Whitespace Strings

- Empty string `''`
- Single space `' '`
- Only whitespace `'   \t\n  '`
- Null bytes `'\0'`

These inputs expose assumptions in text processing code.
