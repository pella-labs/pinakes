# Kafka Producer Optimization

## Batching and Compression

Kafka producers batch messages before sending. Tune for throughput vs latency:

```yaml
batch.size: 65536              # 64KB batch target
linger.ms: 10                  # wait up to 10ms to fill batch
compression.type: lz4          # lz4 for speed, zstd for ratio
buffer.memory: 33554432        # 32MB send buffer
```

## Acknowledgment Levels

- `acks=0`: fire-and-forget, highest throughput, data loss risk
- `acks=1`: leader acknowledged, slight data loss risk
- `acks=all`: all in-sync replicas acknowledged, safest

For mission-critical data, use `acks=all` with `min.insync.replicas=2`.

## Partitioning Strategy

The default partitioner hashes the message key. For ordered processing, ensure related messages share a key. For maximum throughput, use round-robin (null key).

## Idempotent Producer

Enable idempotence to handle network retries without duplicates:

```yaml
enable.idempotence: true
max.in.flight.requests.per.connection: 5
retries: 2147483647
```

This ensures exactly-once delivery from producer to broker.

See [[perf-012]] for Kafka fundamentals and [[perf-041]] for consumer tuning.
