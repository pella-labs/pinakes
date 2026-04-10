# The N+1 Query Problem

## What It Is

The **N+1 query problem** occurs when code executes one query to fetch a list of N records, then N additional queries to fetch related data for each record. This is the single most common performance anti-pattern in ORM-heavy applications.

## Example

```typescript
// BAD: N+1 queries
const users = await db.query('SELECT * FROM users LIMIT 100');
for (const user of users) {
  // This executes 100 times!
  user.orders = await db.query('SELECT * FROM orders WHERE user_id = ?', [user.id]);
}

// GOOD: 2 queries with a JOIN or IN clause
const users = await db.query(`
  SELECT u.*, json_agg(o.*) as orders
  FROM users u
  LEFT JOIN orders o ON o.user_id = u.id
  GROUP BY u.id
  LIMIT 100
`);
```

## Detection

- Enable query logging and look for repetitive patterns
- Use **APM tools** that aggregate query counts per request
- Set up alerts when query count per request exceeds a threshold (e.g., 20)

## Solutions

1. **Eager loading**: use JOINs or subqueries to fetch related data upfront
2. **Batch loading**: collect IDs, fetch in one IN query (DataLoader pattern)
3. **Query count limits**: fail-fast in development if a request exceeds N queries

## The DataLoader Pattern

Facebook's **DataLoader** batches and deduplicates loads within a single tick of the event loop:

```typescript
const userLoader = new DataLoader(async (ids: string[]) => {
  const users = await db.query('SELECT * FROM users WHERE id IN (?)', [ids]);
  return ids.map(id => users.find(u => u.id === id));
});
```

See [[perf-007]] for general query optimization.
