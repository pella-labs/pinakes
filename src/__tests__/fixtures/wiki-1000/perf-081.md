# WebSocket Performance

## Connection Overhead

Each WebSocket connection maintains a persistent TCP connection. At scale, the primary bottleneck is the number of concurrent connections, not throughput per connection.

A single Node.js process can handle ~50,000 concurrent WebSocket connections with careful tuning.

## Scaling WebSockets

- **Sticky sessions**: route reconnections to the same server (required for stateful connections)
- **Redis pub/sub**: broadcast messages across server instances
- **Horizontal scaling**: add servers and use a message broker for cross-server communication

## Heartbeats

Implement application-level heartbeats to detect dead connections:

```typescript
const HEARTBEAT_INTERVAL = 30000;
const HEARTBEAT_TIMEOUT = 10000;

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
});

setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, HEARTBEAT_INTERVAL);
```

## Message Batching

For high-frequency updates (live dashboards, game state), batch multiple updates into a single WebSocket frame rather than sending one message per update. This reduces frame overhead and system call count.

## Compression

Enable per-message compression for text-heavy messages:

```typescript
const wss = new WebSocket.Server({
  perMessageDeflate: {
    threshold: 1024, // only compress messages >1KB
  },
});
```

See [[perf-050]] for TCP optimization.
