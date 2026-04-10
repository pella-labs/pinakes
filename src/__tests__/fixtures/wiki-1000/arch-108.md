# Event-Driven Microservices Pitfalls

## 1. Event Schema Entropy

Without governance, event schemas diverge. Use a schema registry and enforce backward compatibility.

## 2. Invisible Dependencies

Service A publishes event X. Services B, C, D consume it. Who knows about these dependencies? Document them in a service catalog.

## 3. Debugging Distributed Flows

When something goes wrong, the event chain is your stack trace. Without correlation IDs and distributed tracing, debugging is guesswork.

## 4. Ordering Assumptions

"Events always arrive in order" — no, they don't (across partitions). Design consumers to handle out-of-order events or use ordered channels.

## 5. Zombie Events

Old event types that nobody publishes anymore but consumers still expect. Audit your event catalog regularly.

## 6. Chatty Events

Publishing too many fine-grained events creates noise. Prefer coarse-grained domain events over individual field-change events.

## 7. Missing Idempotency

At-least-once delivery means duplicates. Every consumer must be idempotent.

See [[arch-003]], [[arch-083]], [[arch-091]], [[arch-001]].
