# Message Ordering Guarantees

## Ordering Levels

### No Ordering
Messages may arrive in any order. Cheapest, most scalable.

### Partition Ordering (Kafka)
Messages within a partition are ordered. Messages across partitions are not. Choose a partition key that groups related messages.

### Total Ordering
All messages globally ordered. Single partition/queue. Limits throughput.

### Causal Ordering
If message A causes message B, A is delivered before B. Messages without causal relationship may be reordered.

## Kafka Partition Key

```
Key: order_id
  → All events for order-123 go to same partition
  → Events within order-123 are ordered
  → Events across different orders are NOT ordered (fine — they're independent)
```

## When Ordering Matters

- State machine transitions (order lifecycle events)
- Account balance updates
- Chat messages in a conversation

## When It Doesn't

- Independent notifications
- Log aggregation
- Analytics events (reorder at the warehouse)

See [[arch-003]], [[arch-005]].
