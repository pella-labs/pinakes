# Query Plan Analysis

## Reading EXPLAIN Output

```sql
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT * FROM orders WHERE user_id = 42 AND status = 'shipped';
```

Key fields to examine:

- **Actual Time**: wall-clock milliseconds (first row..last row)
- **Rows**: actual vs estimated — large discrepancies indicate stale statistics
- **Buffers**: shared hit (cache) vs read (disk). High reads mean cold cache or large scan
- **Loops**: number of times this node executed (critical in nested loops)

## Red Flags

### Sequential Scan on Large Table
Indicates a missing index. But not always bad: for small tables or queries returning >10% of rows, a seq scan may actually be optimal.

### Nested Loop with High Outer Rows
If the outer relation has 10,000 rows and each loop does an index scan, that's 10,000 index lookups. Consider a hash join instead.

### Sort Spilling to Disk
`Sort Method: external merge Disk: 256kB` means work_mem is too small. Increase it for the session or globally.

### Hash Aggregation Exceeding Memory
Similar to sort spill. Increase `hash_mem_multiplier` or `work_mem`.

## The Statistics Problem

PostgreSQL's query planner relies on `pg_statistic` for cardinality estimates. After bulk operations, run `ANALYZE` on affected tables. For columns with unusual distributions, increase `default_statistics_target`.

See [[perf-007]] for optimization fundamentals and [[perf-037]] for index design.
