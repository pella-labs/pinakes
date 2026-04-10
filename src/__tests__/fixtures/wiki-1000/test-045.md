# Testing Search Functionality

Search is difficult to test because relevance is subjective. Focus on deterministic behavior and regression prevention.

## Exact Match Tests

```typescript
it('finds document by exact title', async () => {
  await index({ id: '1', title: 'Getting Started Guide' });
  const results = await search('Getting Started Guide');
  expect(results[0].id).toBe('1');
});
```

## Partial Match Tests

```typescript
it('finds documents by partial match', async () => {
  await index({ id: '1', title: 'TypeScript Configuration' });
  const results = await search('typescript config');
  expect(results.map(r => r.id)).toContain('1');
});
```

## Relevance Ranking

Test that more relevant results appear first:

```typescript
it('ranks exact matches above partial matches', async () => {
  await index({ id: '1', title: 'React Hooks' });
  await index({ id: '2', title: 'React Hooks: Advanced Patterns' });
  await index({ id: '3', title: 'Fishing Hooks for Beginners' });

  const results = await search('React Hooks');
  expect(results[0].id).toBe('1');
});
```

## Edge Cases

- Empty query string
- Special characters in query
- Very long query strings
- No results found
- Results with identical scores

## Ground Truth Testing

Maintain a set of query-result pairs that represent expected behavior. Run these in CI to detect relevance regressions. See [[test-009]] for regression testing patterns.

## Building a Ground Truth Dataset

For search quality, nothing replaces a curated ground truth dataset. This is a collection of queries paired with the expected top results, ranked by relevance.

Building this dataset requires collaboration between developers and domain experts. The developer understands what the search engine can do; the domain expert understands what users expect.

A ground truth dataset typically has three columns: query, document ID, and relevance score (0-3, where 3 is perfect match). Start with 50-100 queries covering common patterns, edge cases, and known pain points.

Run the dataset against the search engine regularly, tracking metrics like Mean Reciprocal Rank (MRR), Normalized Discounted Cumulative Gain (NDCG), and precision@k. These metrics give you objective feedback when tuning ranking algorithms.

The dataset should evolve with the product. When users report bad search results, add those queries to the ground truth. When new content types are added, create queries that exercise them. Over time, the dataset becomes the definitive specification for search quality.

Automate this evaluation in CI. After any change to the search engine, compare metrics against the baseline. Flag regressions that drop MRR by more than 5%. This catches ranking bugs that no amount of unit testing would find.
