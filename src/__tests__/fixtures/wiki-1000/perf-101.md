# Redis Lua Scripting

## Atomic Operations

Redis executes Lua scripts atomically. No other command can run between the script's commands. This eliminates race conditions without transactions.

```typescript
const script = `
  local current = tonumber(redis.call('GET', KEYS[1]) or '0')
  if current < tonumber(ARGV[1]) then
    redis.call('SET', KEYS[1], ARGV[1])
    return 1
  end
  return 0
`;

// Set value only if higher than current (atomic compare-and-swap)
const result = await redis.eval(script, 1, 'high_score', 42);
```

## Performance Considerations

- Scripts run on the single Redis thread; long scripts block everything
- Keep scripts short (< 5ms execution time)
- Use `EVALSHA` with script caching instead of sending the full script each time
- Avoid loops that process unbounded data

## Use Cases

- Rate limiting with precise semantics
- Atomic read-modify-write operations
- Multi-key operations that need consistency
- Conditional updates based on current state

See [[perf-002]] for Redis patterns and [[perf-061]] for pipelining.
