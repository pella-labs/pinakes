# Capacity Planning for Databases

## Sizing Storage

Estimate row size (data types + overhead + indexes) and multiply by expected row count. Add overhead:

- Index size: typically 1-3x the table data size
- WAL: 2-3x `max_wal_size` for peak write bursts
- VACUUM overhead: 20-30% free space for dead tuple management
- Temporary files: `work_mem * max_connections` for sorts

## Sizing Memory

PostgreSQL memory formula:

```
total_memory = shared_buffers + (work_mem * max_connections) + maintenance_work_mem + OS_cache
```

For a dedicated database server with 64GB RAM:
- `shared_buffers`: 16GB (25%)
- `work_mem`: 256MB (per operation)
- `maintenance_work_mem`: 2GB
- OS page cache: ~40GB (remainder)

## Sizing Connections

Each connection consumes ~5-10MB of memory. 500 connections = 2.5-5GB just for connection overhead. Use PgBouncer for transaction pooling to reduce the connection count.

## IOPS Planning

SSD IOPS requirements depend on workload:

- Read-heavy: IOPS ≈ queries_per_second * pages_per_query
- Write-heavy: IOPS ≈ transactions_per_second * WAL_writes_per_tx

Monitor `pg_stat_bgwriter` and `pg_stat_io` for actual I/O patterns.

## Growth Projection

Track daily table sizes and index sizes. Plot trends and project when current hardware will be exhausted. Plan upgrades or archival strategies 3-6 months ahead.

See [[perf-025]] for general capacity planning and [[perf-099]] for PostgreSQL tuning.
