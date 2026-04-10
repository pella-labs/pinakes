# Memory Leak Detection

## Symptoms

- Steadily increasing RSS (Resident Set Size) over time
- Increasing garbage collection pause times
- Eventually: OOM kills or process crashes

## Heap Snapshots

Take heap snapshots at intervals and compare:

```bash
# Trigger a heap snapshot via signal
kill -USR2 <pid>

# Or use the inspector protocol
node --inspect app.js
# Then in Chrome DevTools: Memory > Take Snapshot
```

## Common Leak Patterns in Node.js

### Event Listener Accumulation
Adding listeners without removing them:
```typescript
// LEAK: new listener on every request
server.on('request', (req) => {
  eventBus.on('update', handler); // never removed!
});
```

### Closure Captures
Closures that capture large objects and are stored in long-lived collections:
```typescript
const cache = new Map();
function processData(largeBuffer: Buffer) {
  // The closure captures largeBuffer even though only id is needed
  cache.set(id, () => transform(largeBuffer));
}
```

### Global Caches Without Eviction
Maps or objects that grow unbounded because nothing ever deletes entries.

## Prevention

- Set `--max-old-space-size` to a known limit
- Monitor heap usage with Prometheus metrics
- Use WeakRef and FinalizationRegistry for caches where appropriate
- Review code for unbounded collections during code review

See [[perf-026]] for CPU profiling.
