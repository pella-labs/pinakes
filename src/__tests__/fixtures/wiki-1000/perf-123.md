---
title: Data Compression in Transit and at Rest
tags: [compression, performance, storage]
---
# Data Compression in Transit and at Rest

## Transit Compression

Compressing data between services reduces network bandwidth and transfer time. The tradeoff is CPU overhead for compression and decompression.

### Algorithm Selection by Use Case

- **gzip**: universal compatibility, moderate speed and ratio
- **lz4**: very fast, lower ratio. Best for internal service communication where speed matters more than size.
- **zstd**: excellent ratio at high speed. Good for log shipping and backup.
- **snappy**: fast compression, used in Kafka and Cassandra.

## At-Rest Compression

### Database Level
PostgreSQL TOAST compresses large values automatically. For MySQL/InnoDB, enable page compression:

```sql
ALTER TABLE events ROW_FORMAT=COMPRESSED KEY_BLOCK_SIZE=8;
```

### File System Level
ZFS and Btrfs support transparent compression. Data is compressed on write and decompressed on read without application changes.

### Object Storage
Compress before uploading to S3/GCS. Significant cost savings for log archives and backups.

## When Not to Compress

- Already compressed data (images, video, encrypted payloads)
- Small payloads (< 150 bytes) where overhead exceeds savings
- Latency-critical paths where CPU time matters more than bandwidth
- When the decompression cost at query time exceeds the storage savings

See [[perf-078]] for HTTP compression.
