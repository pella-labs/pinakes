# Event-Driven Architecture

## What It Is

An **event-driven architecture** (EDA) uses events as the primary mechanism for communication between components. Events represent facts — things that happened — and are immutable.

## Event Types

### Domain Events
Business-meaningful state changes: `OrderPlaced`, `PaymentReceived`, `UserRegistered`.

### Integration Events
Cross-service events published to a broker for other services to consume.

### System Events
Infrastructure-level: health checks, scaling triggers, deployment notifications.

## Broker Choices

- **Kafka** — high throughput, durable log, exactly-once semantics (with effort)
- **RabbitMQ** — flexible routing, lower latency for small messages
- **NATS** — lightweight, good for edge/IoT
- **Redis Streams** — if you already run Redis and need simple pub/sub

## Event Schema Evolution

Use a schema registry (Confluent, Apicurio) and **Avro** or **Protobuf** for forward/backward compatibility. Never break consumers by removing or renaming fields.

```json
{
  "event_type": "OrderPlaced",
  "version": 2,
  "data": {
    "order_id": "ord-12345",
    "customer_id": "cust-678",
    "total_cents": 4999,
    "currency": "USD"
  },
  "metadata": {
    "timestamp": "2024-06-15T10:30:00Z",
    "correlation_id": "corr-abc"
  }
}
```

See [[arch-010]], [[database-sharding]].
