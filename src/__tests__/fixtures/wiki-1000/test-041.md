# Testing GraphQL APIs

GraphQL APIs have unique testing requirements due to their flexible query language and schema-driven nature.

## Schema Testing

Verify the schema is valid and contains expected types:

```typescript
import { buildSchema, validateSchema } from 'graphql';

it('schema has no errors', () => {
  const schema = buildSchema(schemaString);
  const errors = validateSchema(schema);
  expect(errors).toHaveLength(0);
});
```

## Resolver Testing

Test resolvers as plain functions:

```typescript
it('resolves user with posts', async () => {
  const user = await resolvers.Query.user(null, { id: '1' }, context);
  expect(user.name).toBe('Alice');

  const posts = await resolvers.User.posts(user, {}, context);
  expect(posts).toHaveLength(3);
});
```

## Query Testing

Test actual GraphQL queries against the running server:

```typescript
it('fetches user profile', async () => {
  const query = `
    query {
      user(id: "1") {
        name
        email
        posts { title }
      }
    }
  `;

  const result = await server.executeOperation({ query });
  expect(result.data?.user.name).toBe('Alice');
  expect(result.data?.user.posts).toHaveLength(3);
});
```

## N+1 Query Detection

GraphQL is prone to N+1 queries. Use dataloaders and test that the number of database queries doesn't scale with the number of requested items.

## Authorization in Resolvers

Test that resolvers enforce authorization. A user should not be able to query another user's private data even if the schema allows it.
