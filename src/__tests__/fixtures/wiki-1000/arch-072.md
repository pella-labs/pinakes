# gRPC Architecture

## What It Is

**gRPC** is a high-performance RPC framework using HTTP/2 and Protocol Buffers.

## Service Definition

```protobuf
syntax = "proto3";

service OrderService {
  rpc CreateOrder (CreateOrderRequest) returns (CreateOrderResponse);
  rpc GetOrder (GetOrderRequest) returns (Order);
  rpc ListOrders (ListOrdersRequest) returns (stream Order);
  rpc StreamUpdates (StreamRequest) returns (stream OrderUpdate);
}

message CreateOrderRequest {
  string customer_id = 1;
  repeated OrderItem items = 2;
}
```

## Streaming

gRPC supports four patterns:
- **Unary** — single request, single response
- **Server streaming** — single request, stream of responses
- **Client streaming** — stream of requests, single response
- **Bidirectional streaming** — both sides stream

## When to Use

- Internal service-to-service communication
- High throughput, low latency requirements
- Strongly typed contracts across languages
- Streaming use cases

## When Not to Use

- Browser clients (limited gRPC-web support)
- Simple CRUD APIs (REST is simpler)
- Public APIs where curl-ability matters

See [[api-rest-design]], [[arch-001]].
