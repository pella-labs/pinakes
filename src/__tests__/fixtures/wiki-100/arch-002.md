# Event-Driven Architecture

Event-driven architecture (EDA) structures applications around the production, detection, and reaction to events. An **event** is an immutable record of something that happened — a fact, not a command.

## Event Types

### Domain Events

Domain events represent something meaningful that occurred in the business domain. `OrderPlaced`, `PaymentProcessed`, `InventoryReserved`. They carry enough context for any consumer to act without calling back to the source.

### Integration Events

Integration events cross service boundaries. They are the public contract of a service. Keep them lean — include IDs and essential state, not the full aggregate. Consumers that need more data should query the source via [[api-design]].

## Event Bus Infrastructure

The event bus is the backbone. Common choices:

- **Apache Kafka**: high throughput, durable log, exactly-once semantics with transactions. Best for event sourcing.
- **NATS JetStream**: lighter weight, good for cloud-native workloads.
- **RabbitMQ**: mature, flexible routing with exchanges and queues. Better for task distribution than event streaming.

```typescript
interface DomainEvent<T = unknown> {
  eventId: string;
  eventType: string;
  aggregateId: string;
  timestamp: string;
  version: number;
  payload: T;
  metadata: {
    correlationId: string;
    causationId: string;
    source: string;
  };
}
```

## Ordering and Idempotency

Events may arrive out of order or be delivered more than once. Design consumers to be **idempotent** — processing the same event twice must produce the same result. Use the `eventId` for deduplication and the `version` field for ordering within an aggregate.

## Choreography vs Orchestration

In **choreography**, each service reacts to events independently. No central coordinator. This is more decoupled but harder to debug — you need distributed tracing (see [[monitoring-setup]]).

In **orchestration**, a saga coordinator drives the workflow, issuing commands and reacting to events. More visible control flow but introduces a single point of coordination.

Most real systems use a mix. Use choreography for loosely coupled flows (notifications, analytics) and orchestration for critical business transactions (order fulfillment, payment processing).
