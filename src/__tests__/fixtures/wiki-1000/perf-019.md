---
title: Structured Logging Best Practices
tags: [logging, observability, pino]
---
# Structured Logging Best Practices

## Why Structured

Unstructured log lines like `User 123 placed order 456` are human-readable but machine-hostile. **Structured logs** emit JSON, making them searchable, filterable, and aggregatable.

```typescript
import pino from 'pino';

const logger = pino({ level: 'info' });

// BAD: unstructured
logger.info(`User ${userId} placed order ${orderId}`);

// GOOD: structured
logger.info({ userId, orderId, total: order.total }, 'order placed');
```

## Log Levels

Use levels consistently:

- **error**: something failed and needs investigation
- **warn**: something unexpected but the system recovered
- **info**: significant business events (order placed, user signed up)
- **debug**: technical details for troubleshooting (disabled in production)

## Correlation IDs

Include a **request ID** and **trace ID** in every log entry. This lets you reconstruct the full request flow from logs alone.

## What Not to Log

- PII (names, emails, addresses) — redact or hash
- Secrets (API keys, tokens, passwords)
- High-cardinality debugging data in production
- Every iteration of a loop

## Log Aggregation

Ship logs to a centralized system (Elasticsearch, Loki, Datadog) and set up:

- Full-text search across all services
- Log-based alerts for error spikes
- Dashboards showing log volume by level and service

See [[perf-017]] for OpenTelemetry integration.
