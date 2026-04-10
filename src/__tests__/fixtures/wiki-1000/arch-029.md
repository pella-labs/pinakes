# Outbox Pattern

## Problem

You need to update a database AND publish an event, atomically. But your DB and your message broker are different systems — you can't wrap them in a single transaction.

## Solution

Write the event to an **outbox table** in the same database transaction as the business data. A separate process reads the outbox and publishes to the broker.

## Schema

```sql
CREATE TABLE outbox (
  id UUID PRIMARY KEY,
  aggregate_type VARCHAR(255),
  aggregate_id VARCHAR(255),
  event_type VARCHAR(255),
  payload JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  published_at TIMESTAMPTZ NULL
);
```

## Publisher

A polling process or CDC (Change Data Capture) stream reads unpublished rows and sends them to the broker, then marks them published.

## Debezium CDC

Instead of polling, use **Debezium** to stream the outbox table's WAL to Kafka. This is the **transactional outbox + CDC** pattern — lower latency, no polling overhead.

See [[arch-003]], [[arch-016]], [[database-sharding]].
