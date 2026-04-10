# gRPC Performance Characteristics

## Why gRPC is Faster

**gRPC** uses HTTP/2 for transport and Protocol Buffers for serialization. Compared to REST+JSON:

- Binary serialization is 3-10x smaller than JSON
- HTTP/2 multiplexing avoids head-of-line blocking
- Bidirectional streaming for real-time data
- Strong typing eliminates parsing ambiguity

## Connection Management

gRPC uses long-lived HTTP/2 connections. A single connection supports up to 100 concurrent streams by default. For high-throughput services, use a **subchannel pool** to spread load across connections.

## Deadline Propagation

gRPC has built-in deadline propagation. Set a deadline on the client; every downstream service receives the remaining time automatically. This prevents wasted work on requests that will timeout anyway.

## Load Balancing Challenges

Because gRPC uses persistent connections, traditional L4 load balancers route all requests from one client to one server. Solutions:

- Use L7 load balancing (Envoy, Linkerd)
- Client-side load balancing with service discovery
- Periodic connection cycling

## Compression

Enable gzip compression for large payloads:

```typescript
const client = new ServiceClient(address, credentials, {
  'grpc.default_compression_algorithm': 2, // gzip
  'grpc.default_compression_level': 2,     // medium
});
```

See [[perf-050]] for TCP optimization.
