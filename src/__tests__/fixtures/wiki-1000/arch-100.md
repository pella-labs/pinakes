# Microservices Communication Patterns

## Synchronous

### REST
HTTP-based, ubiquitous. Best for public APIs and simple CRUD.

### gRPC
Binary protocol, strong typing, streaming. Best for internal service-to-service.

## Asynchronous

### Event-Driven
Publish events to a broker. Loose coupling, eventual consistency.

### Message Queue
Direct message delivery. Request-reply over async transport.

## Choosing

| Need | Pattern |
|---|---|
| Simple query | REST GET |
| Immediate response needed | REST or gRPC |
| Long-running operation | Async message + webhook callback |
| Broadcasting state changes | Event-driven (pub/sub) |
| Reliable task processing | Message queue with competing consumers |
| Real-time bidirectional | gRPC streaming or WebSockets |

## Service Communication Matrix

Document which services talk to which, using what protocol. This becomes your architecture's nervous system map.

See [[arch-001]], [[arch-072]], [[arch-003]], [[api-rest-design]].
