# Batch Processing Optimization

## Batch Size Tuning

The optimal batch size balances:
- **Too small**: overhead per batch (connection setup, transaction commit) dominates
- **Too large**: memory usage, lock contention, and recovery time increase

Start with 1000 records per batch and tune from there.

## Bulk Insert Performance

```typescript
// BAD: one INSERT per row
for (const row of rows) {
  await db.query('INSERT INTO events (data) VALUES ($1)', [row]);
}

// GOOD: bulk INSERT with VALUES list
const values = rows.map((r, i) => `($${i + 1})`).join(',');
await db.query(`INSERT INTO events (data) VALUES ${values}`, rows);

// BEST: COPY for maximum throughput
const stream = client.query(copyFrom('COPY events (data) FROM STDIN'));
for (const row of rows) {
  stream.write(`${row}\n`);
}
stream.end();
```

## Parallel Batch Processing

Process independent batches concurrently with bounded parallelism:

```typescript
const BATCH_SIZE = 1000;
const PARALLELISM = 4;
const batches = chunk(allRecords, BATCH_SIZE);

for (let i = 0; i < batches.length; i += PARALLELISM) {
  await Promise.all(
    batches.slice(i, i + PARALLELISM).map(batch => processBatch(batch))
  );
}
```

## Checkpoint and Resume

For long-running batch jobs, periodically checkpoint progress. On failure, resume from the last checkpoint instead of starting over.

See [[perf-013]] for worker pools and [[perf-010]] for message queues.
