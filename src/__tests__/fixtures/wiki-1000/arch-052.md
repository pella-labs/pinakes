# Pub/Sub vs Request/Reply

## Request/Reply

Synchronous-style communication. Caller sends a request, waits for a response. HTTP, gRPC, direct function calls.

**Pros**: Simple mental model, easy error handling, immediate feedback.
**Cons**: Temporal coupling (both sides must be available), harder to scale.

## Pub/Sub

Asynchronous communication. Publisher emits events, subscribers process them independently.

**Pros**: Loose coupling, natural scalability, resilience (publisher doesn't care if subscriber is down).
**Cons**: Eventual consistency, harder debugging, message ordering challenges.

## When to Use Which

| Scenario | Pattern |
|---|---|
| UI needs immediate response | Request/reply |
| Cross-service data sync | Pub/sub |
| Payment processing | Request/reply (need confirmation) |
| Sending notifications | Pub/sub |
| Real-time dashboards | Pub/sub with websockets |

## Hybrid

Most systems use both. Critical synchronous paths use request/reply; background processing uses pub/sub.

See [[arch-003]], [[api-rest-design]].
