# Redis Pipelining

## Reducing Round Trips

Each Redis command requires a round trip: send command, wait for response. With 100 commands at 1ms RTT, that's 100ms of waiting. **Pipelining** batches multiple commands into a single round trip.

```typescript
const pipeline = redis.pipeline();
for (const key of keys) {
  pipeline.get(key);
}
const results = await pipeline.exec();
```

## Performance Impact

Pipelining can improve throughput by 5-10x for batch operations. The improvement comes from eliminating network round trips and reducing system call overhead.

## Pipelining vs Transactions

Pipelining is about batching for performance. Transactions (`MULTI/EXEC`) are about atomicity. You can combine both: pipeline commands inside a transaction for atomic batch operations.

## Limitations

- Responses arrive in order, so you need to correlate results with commands
- Very large pipelines consume server memory buffering responses
- If one command fails, others still execute (unlike transactions)

See [[perf-002]] for Redis patterns.
