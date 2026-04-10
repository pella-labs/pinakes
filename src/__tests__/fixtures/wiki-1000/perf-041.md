# Kafka Consumer Tuning

## Consumer Configuration

The key settings that affect Kafka consumer performance:

```yaml
# Consumer properties
max.poll.records: 500          # records per poll() call
max.poll.interval.ms: 300000   # max time between polls before rebalance
fetch.min.bytes: 1024          # wait for at least 1KB before returning
fetch.max.wait.ms: 500         # max wait for fetch.min.bytes
session.timeout.ms: 45000      # consumer health check timeout
heartbeat.interval.ms: 15000   # heartbeat frequency
```

## Batching for Throughput

Process records in batches rather than one-at-a-time. Batch database inserts, batch API calls, batch serialization.

## Offset Management

- **Auto-commit**: simple but risks reprocessing or data loss
- **Manual commit after processing**: at-least-once semantics
- **Manual commit before processing**: at-most-once (rarely used)

For exactly-once processing, store the offset alongside the processed result in the same transaction (the **transactional outbox** pattern).

## Lag Monitoring

Consumer lag is the difference between the latest offset and the consumer's committed offset. Monitor per-partition lag:

```bash
kafka-consumer-groups.sh --bootstrap-server localhost:9092 \
  --describe --group my-consumer-group
```

Alert when lag exceeds a threshold or is growing monotonically.

See [[perf-012]] for Kafka fundamentals.
