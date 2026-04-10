# Testing Streaming Responses

Streaming APIs deliver data progressively. Testing them requires handling partial responses and backpressure.

## Node.js Readable Streams

```typescript
it('streams CSV rows', async () => {
  const stream = createCsvStream(testData);
  const rows: string[] = [];

  for await (const chunk of stream) {
    rows.push(chunk.toString());
  }

  expect(rows).toHaveLength(100);
  expect(rows[0]).toContain('id,name,email');
});
```

## Server-Sent Events

```typescript
it('streams updates via SSE', async () => {
  const response = await fetch('/api/updates', {
    headers: { Accept: 'text/event-stream' },
  });

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const events: string[] = [];

  while (events.length < 3) {
    const { value, done } = await reader.read();
    if (done) break;
    events.push(decoder.decode(value));
  }

  expect(events.length).toBeGreaterThanOrEqual(3);
});
```

## Error Mid-Stream

Test that errors occurring during streaming are handled gracefully. The client should receive an error indication, not a truncated response that looks valid.

## Backpressure

Test that the producer respects backpressure from a slow consumer. If the consumer can't keep up, the producer should slow down rather than buffering unbounded data.
