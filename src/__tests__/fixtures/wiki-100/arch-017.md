---
source: ai-generated
confidence: ambiguous
---

# Outbox Pattern

The **outbox pattern** ensures reliable event publishing in systems where the database write and event publish must be atomic. Instead of publishing events directly, write them to an outbox table within the same database transaction, then relay them to the event bus asynchronously.

## The Problem

Consider an order service that saves an order and publishes an `OrderCreated` event:

1. Save order to database -- succeeds
2. Publish `OrderCreated` to Kafka -- fails (network issue)

The order exists but no event was published. Downstream services never learn about it. The dual-write problem.

## The Solution

```sql
-- Within the same transaction
BEGIN;

INSERT INTO orders (id, customer_id, total, status)
VALUES ('ord-123', 'cust-456', 9999, 'pending');

INSERT INTO outbox (
    id, aggregate_type, aggregate_id,
    event_type, payload, created_at
) VALUES (
    gen_random_uuid(), 'Order', 'ord-123',
    'OrderCreated',
    '{"orderId":"ord-123","customerId":"cust-456","total":9999}',
    now()
);

COMMIT;
```

A separate **relay process** polls the outbox table (or uses CDC/change data capture) and publishes events to the message broker, then marks them as published.

## Relay Strategies

- **Polling publisher**: simple `SELECT ... WHERE published = false` on an interval. Works but adds latency.
- **Transaction log tailing**: use Debezium or similar CDC tool to tail the database WAL/binlog. Lower latency, more operational complexity.

## Cleanup

The outbox table grows indefinitely if not pruned. Run a periodic job to delete published events older than a retention period (e.g., 7 days).

This pattern is essential for reliable event publishing in [[arch-002]] event-driven systems and [[arch-014]] event-sourced systems. The outbox is often paired with the [[arch-010]] saga pattern for distributed transaction management.
