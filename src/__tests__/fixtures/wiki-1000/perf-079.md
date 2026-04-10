# Database Partitioning

## Partitioning vs Sharding

**Partitioning** divides a single table into smaller physical segments within the same database. **Sharding** distributes data across separate database instances. Partitioning is simpler and should be tried first.

## Partitioning Strategies

### Range Partitioning
Divide by value ranges, typically timestamps:

```sql
CREATE TABLE events (
  id bigserial,
  created_at timestamptz NOT NULL,
  data jsonb
) PARTITION BY RANGE (created_at);

CREATE TABLE events_2025_q1 PARTITION OF events
  FOR VALUES FROM ('2025-01-01') TO ('2025-04-01');
CREATE TABLE events_2025_q2 PARTITION OF events
  FOR VALUES FROM ('2025-04-01') TO ('2025-07-01');
```

### List Partitioning
Divide by discrete values:

```sql
CREATE TABLE orders (
  id bigserial,
  region text NOT NULL,
  total numeric
) PARTITION BY LIST (region);

CREATE TABLE orders_us PARTITION OF orders FOR VALUES IN ('us-east', 'us-west');
CREATE TABLE orders_eu PARTITION OF orders FOR VALUES IN ('eu-west', 'eu-central');
```

### Hash Partitioning
Distribute evenly across N partitions based on a hash of the partition key.

## Benefits

- **Partition pruning**: queries that filter on the partition key only scan relevant partitions
- **Maintenance**: VACUUM, ANALYZE, and REINDEX operate on individual partitions
- **Archival**: drop old partitions instead of deleting rows

## When to Partition

Partition when tables exceed 10-50GB and queries consistently filter on a natural partition key.

See [[perf-053]] for sharding and [[perf-077]] for VACUUM.
