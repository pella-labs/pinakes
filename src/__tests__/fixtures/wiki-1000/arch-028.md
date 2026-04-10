---
confidence: ambiguous
---
# Bulkhead Pattern

## Analogy

Ship hulls are divided into watertight compartments (bulkheads). If one compartment floods, the ship stays afloat.

## In Software

**Bulkheads** isolate failures by partitioning resources. If one component fails or exhausts its resources, others continue operating.

## Implementation Approaches

- **Thread pool isolation** — each dependency gets its own thread pool
- **Connection pool isolation** — separate DB connection pools per tenant or feature
- **Process isolation** — run critical services in separate processes
- **Pod isolation** — dedicate K8s nodes/pods to critical workloads

## Example: Thread Pool Bulkhead

```java
// resilience4j bulkhead
BulkheadConfig config = BulkheadConfig.custom()
    .maxConcurrentCalls(10)
    .maxWaitDuration(Duration.ofMillis(500))
    .build();

Bulkhead paymentBulkhead = Bulkhead.of("payment", config);
Bulkhead inventoryBulkhead = Bulkhead.of("inventory", config);
```

If the payment service is slow, it only exhausts its own 10-thread pool. Inventory calls are unaffected.

See [[arch-014]], [[arch-015]].
