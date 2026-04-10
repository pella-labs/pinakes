# Write-Ahead Logging (WAL)

## How WAL Works

Instead of writing directly to data pages, the database first writes the change to a sequential **write-ahead log**. The WAL is flushed to disk, then the data pages are updated lazily in the background.

## Why It Matters for Performance

Sequential writes to the WAL are much faster than random writes to data pages. This is especially true for spinning disks but also significant for SSDs.

## WAL Configuration in PostgreSQL

```sql
-- Write to WAL without waiting for OS flush (faster, slight durability risk)
SET synchronous_commit = off;

-- WAL segment size (default 16MB, increase for write-heavy workloads)
-- Set at initdb time: --wal-segsize=64

-- Checkpoint frequency
checkpoint_timeout = '10min'
max_wal_size = '2GB'
min_wal_size = '512MB'
```

## Checkpoint Tuning

**Checkpoints** flush dirty pages from shared buffers to disk. They're expensive I/O operations. Spread them out:

- `checkpoint_completion_target = 0.9` — spread checkpoint I/O over 90% of the interval
- Increase `max_wal_size` to reduce checkpoint frequency
- Monitor checkpoint frequency in `pg_stat_bgwriter`

## WAL for Replication

WAL segments are shipped to replicas for physical replication. WAL archiving enables Point-in-Time Recovery (PITR). Both are critical for disaster recovery.

See [[perf-052]] for read replicas.
