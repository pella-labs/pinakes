# Efficient Pagination

## Offset-Based Pagination Problems

```sql
SELECT * FROM orders ORDER BY created_at DESC LIMIT 20 OFFSET 10000;
```

The database still scans and discards 10,000 rows. Performance degrades linearly with page depth.

## Cursor-Based Pagination

Use the last seen value as a cursor:

```sql
-- First page
SELECT * FROM orders ORDER BY created_at DESC LIMIT 20;

-- Next page (using last row's created_at)
SELECT * FROM orders 
WHERE created_at < '2025-11-15T10:30:00Z'
ORDER BY created_at DESC 
LIMIT 20;
```

This uses the index efficiently regardless of page depth.

## Keyset Pagination with Ties

When the sort column has duplicate values, include the primary key as a tiebreaker:

```sql
SELECT * FROM orders 
WHERE (created_at, id) < ('2025-11-15T10:30:00Z', 12345)
ORDER BY created_at DESC, id DESC 
LIMIT 20;
```

## Total Count Problem

`COUNT(*)` on large tables is expensive. Alternatives:

- Estimate from `pg_class.reltuples` (fast but approximate)
- Cache the count and refresh periodically
- Don't show total count (use "load more" instead of page numbers)

## API Design

Return pagination metadata in the response:

```json
{
  "data": [...],
  "pagination": {
    "next_cursor": "eyJjcmVhdGVkX2F0IjoiMjAyNS0xMS0xNSJ9",
    "has_more": true
  }
}
```

See [[perf-007]] for query optimization.
