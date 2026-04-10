# Testing Image Processing

Image processing code needs both correctness tests and performance benchmarks.

## Dimensions and Format

```typescript
it('resizes image to thumbnail', async () => {
  const input = await readFile('fixtures/photo.jpg');
  const output = await resize(input, { width: 150, height: 150 });
  const metadata = await sharp(output).metadata();

  expect(metadata.width).toBe(150);
  expect(metadata.height).toBe(150);
  expect(metadata.format).toBe('jpeg');
});
```

## Quality Preservation

Verify that image quality is acceptable after processing. Use perceptual hash comparison rather than byte-level comparison:

```typescript
it('maintains visual quality', async () => {
  const original = await readFile('fixtures/photo.jpg');
  const processed = await optimize(original, { quality: 80 });
  const similarity = await compareImages(original, processed);

  expect(similarity).toBeGreaterThan(0.95); // 95% similar
});
```

## Error Handling

- Corrupt image files
- Unsupported formats
- Zero-byte files
- Extremely large images
- Images with embedded metadata (EXIF)

## Memory Usage

Image processing can consume large amounts of memory. Test that processing a batch of images doesn't exceed memory limits. See [[test-049]] for memory leak testing.
