# Async I/O in Node.js

## The Event Loop Model

Node.js uses a single-threaded event loop with non-blocking I/O. Operations that would block (file reads, network calls, DNS) are delegated to the OS or a thread pool and signaled back via callbacks.

## libuv Thread Pool

Node.js delegates blocking operations to libuv's thread pool. The default pool size is 4 threads. Increase it for I/O-heavy applications:

```bash
UV_THREADPOOL_SIZE=16 node app.js
```

Operations that use the thread pool:
- File system operations
- DNS lookups (dns.lookup, not dns.resolve)
- Some crypto operations
- zlib compression

## Promises and Performance

Avoid creating unnecessary promises. Each promise allocation has overhead:

```typescript
// BAD: unnecessary promise wrapper
function getUser(id: string): Promise<User> {
  return new Promise((resolve) => {
    resolve(cache.get(id)); // already synchronous
  });
}

// GOOD: return value directly when synchronous
function getUser(id: string): User | Promise<User> {
  const cached = cache.get(id);
  if (cached) return cached;
  return fetchUser(id);
}
```

## Streams for Large Data

Use streams instead of buffering entire files or responses in memory. Streams process data chunk by chunk with constant memory usage regardless of data size.

See [[perf-059]] for event loop monitoring.
