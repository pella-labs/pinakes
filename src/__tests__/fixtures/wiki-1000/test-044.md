# Testing Pagination

Pagination seems simple but has many edge cases. Thorough testing prevents off-by-one errors and inconsistent results.

## Basic Pagination Tests

```typescript
describe('paginated users', () => {
  beforeAll(async () => {
    await seedUsers(25); // create 25 users
  });

  it('returns first page', async () => {
    const result = await getUsers({ page: 1, pageSize: 10 });
    expect(result.items).toHaveLength(10);
    expect(result.totalPages).toBe(3);
    expect(result.hasNextPage).toBe(true);
  });

  it('returns last page with remaining items', async () => {
    const result = await getUsers({ page: 3, pageSize: 10 });
    expect(result.items).toHaveLength(5);
    expect(result.hasNextPage).toBe(false);
  });

  it('returns empty for page beyond total', async () => {
    const result = await getUsers({ page: 10, pageSize: 10 });
    expect(result.items).toHaveLength(0);
  });
});
```

## Cursor-Based Pagination

Cursor pagination avoids the "page drift" problem where items shift between pages during reads:

```typescript
it('cursor pagination is stable during inserts', async () => {
  const page1 = await getUsers({ cursor: null, limit: 10 });
  await insertUser({ name: 'New User' }); // insert during pagination
  const page2 = await getUsers({ cursor: page1.nextCursor, limit: 10 });

  // No duplicates across pages
  const allIds = [...page1.items, ...page2.items].map(u => u.id);
  expect(new Set(allIds).size).toBe(allIds.length);
});
```

## Edge Cases

- Empty collection
- Single item
- Page size larger than total items
- Page size of 1
- Negative page numbers (should be rejected)
