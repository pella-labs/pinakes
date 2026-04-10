# JSON Serialization Performance

## The Hidden Cost

JSON.parse and JSON.stringify are often the top CPU consumers in Node.js applications. For a 1MB JSON payload, serialization can take 10-50ms.

## Optimization Strategies

### Avoid Round-Trip Serialization
If data enters as JSON (e.g., from Redis) and leaves as JSON (HTTP response), don't parse and re-stringify. Pass the string through.

### Schema-Based Serialization
Use `fast-json-stringify` which generates a serializer from a JSON Schema:

```typescript
import fastJson from 'fast-json-stringify';

const stringify = fastJson({
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    score: { type: 'number' },
  },
});

// 2-5x faster than JSON.stringify
const json = stringify({ id: '123', name: 'test', score: 42 });
```

### Streaming JSON Parse
For large JSON payloads, use a streaming parser to avoid loading the entire object into memory.

### Binary Alternatives
For internal service-to-service communication, consider Protocol Buffers, MessagePack, or CBOR. They offer smaller payloads and faster serialization.

## Measuring Impact

Profile your application to quantify JSON overhead. If serialization accounts for >10% of CPU time, optimization is worthwhile.

See [[perf-058]] for profiling and [[perf-051]] for gRPC/protobuf.
