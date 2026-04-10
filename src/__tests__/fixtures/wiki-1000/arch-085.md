# Write-Ahead Logging

## Concept

A **write-ahead log** (WAL) records all changes before they're applied to the actual data. If the system crashes mid-write, replay the WAL to recover.

## How Databases Use WAL

1. Transaction begins
2. Changes written to WAL (sequential, fast)
3. Acknowledgment sent to client
4. Changes lazily applied to data files (checkpoint)

## Benefits

- **Durability** — committed transactions survive crashes
- **Performance** — sequential writes to WAL are faster than random writes to data files
- **Replication** — stream the WAL to replicas (PostgreSQL logical replication, MySQL binlog)

## SQLite WAL Mode

```sql
PRAGMA journal_mode = WAL;
```

In WAL mode, readers don't block writers and writers don't block readers. Critical for our use case.

## CDC from WAL

Change Data Capture reads the WAL to stream changes to other systems (Debezium reads PostgreSQL WAL, Maxwell reads MySQL binlog).

See [[arch-029]], [[database-sharding]], [[arch-084]].
