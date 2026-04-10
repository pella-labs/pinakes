# Testing WebSocket Connections

WebSocket testing requires handling bidirectional communication, connection lifecycle, and message ordering.

## Basic Connection Test

```typescript
import WebSocket from 'ws';

describe('WebSocket server', () => {
  let server: WebSocketServer;
  let client: WebSocket;

  beforeEach(async () => {
    server = await startServer(0); // random port
    const port = server.address().port;
    client = new WebSocket(`ws://localhost:${port}`);
    await new Promise(resolve => client.on('open', resolve));
  });

  afterEach(() => {
    client.close();
    server.close();
  });

  it('echoes messages', (done) => {
    client.on('message', (data) => {
      expect(data.toString()).toBe('hello');
      done();
    });
    client.send('hello');
  });
});
```

## Testing Reconnection

Verify that clients reconnect after server restarts or network interruptions. Simulate disconnection and verify the client's recovery behavior.

## Message Ordering

WebSocket guarantees message ordering per connection. Test that your application handles messages in the expected sequence and correctly handles out-of-sequence application-level messages.

## Load Testing WebSockets

Use **Artillery** or **k6** with WebSocket support to test connection scaling. A server that handles 10 connections might fail at 10,000. See [[test-017]] for load testing fundamentals.
