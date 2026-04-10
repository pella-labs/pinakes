
# Testing Compression

Compression reduces bandwidth and storage. Testing ensures correctness and verifies the compression ratio meets requirements.

## Roundtrip Testing

```typescript
it('compresses and decompresses correctly', () => {
  const original = 'a'.repeat(10000);
  const compressed = gzip(original);
  const decompressed = gunzip(compressed);

  expect(decompressed).toBe(original);
  expect(compressed.length).toBeLessThan(original.length);
});
```

## HTTP Compression

```typescript
it('serves gzipped responses', async () => {
  const res = await request(app)
    .get('/api/large-data')
    .set('Accept-Encoding', 'gzip');

  expect(res.headers['content-encoding']).toBe('gzip');
});

it('serves uncompressed for clients that dont support it', async () => {
  const res = await request(app)
    .get('/api/large-data')
    .set('Accept-Encoding', 'identity');

  expect(res.headers['content-encoding']).toBeUndefined();
});
```

## Minimum Size Threshold

Small responses shouldn't be compressed (overhead exceeds savings):

```typescript
it('does not compress small responses', async () => {
  const res = await request(app)
    .get('/api/tiny-data') // returns < 1KB
    .set('Accept-Encoding', 'gzip');

  expect(res.headers['content-encoding']).toBeUndefined();
});
```

## Corruption Detection

Test that decompression correctly detects corrupted data rather than silently producing garbage output.
