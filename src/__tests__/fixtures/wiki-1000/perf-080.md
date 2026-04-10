# Streaming Responses

## Why Stream

For large responses, streaming sends data incrementally rather than buffering the entire response before sending. Benefits:

- **Time to first byte**: users see content sooner
- **Memory efficiency**: server doesn't buffer the full response
- **Cancellation**: if the client disconnects, the server can stop work

## Server-Sent Events (SSE)

```typescript
app.get('/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  const interval = setInterval(() => {
    const data = JSON.stringify({ timestamp: Date.now(), value: getMetric() });
    res.write(`data: ${data}\n\n`);
  }, 1000);

  req.on('close', () => clearInterval(interval));
});
```

## Chunked Transfer Encoding

HTTP chunked encoding sends the response in pieces. The server can start sending before it knows the total content length.

## Streaming Database Results

Instead of loading all rows into memory:

```typescript
const cursor = db.query(new Cursor('SELECT * FROM large_table'));
let rows = await cursor.read(100);
while (rows.length > 0) {
  for (const row of rows) {
    res.write(JSON.stringify(row) + '\n');
  }
  rows = await cursor.read(100);
}
res.end();
```

See [[perf-060]] for HTTP/2 and [[perf-080]].
