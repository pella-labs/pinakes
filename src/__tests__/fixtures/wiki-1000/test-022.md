# API Contract Testing

**API contract testing** ensures that API providers and consumers agree on the shape, types, and behavior of API interactions.

## Beyond Pact

While [[test-004]] covers Pact specifically, contract testing has broader patterns:

### Schema-Based Contracts

Use OpenAPI or JSON Schema as the contract:

```typescript
import Ajv from 'ajv';

const ajv = new Ajv();
const validate = ajv.compile(userSchema);

test('GET /users/:id matches schema', async () => {
  const response = await api.get('/users/1');
  const valid = validate(response.data);
  expect(valid).toBe(true);
  if (!valid) console.log(validate.errors);
});
```

### Type-Level Contracts

With TypeScript, shared type definitions serve as compile-time contracts between frontend and backend. Tools like **tRPC** and **ts-rest** enforce this at the type level.

## Consumer-Driven vs Provider-Driven

- **Consumer-driven**: Consumers define what they need. Providers must fulfill all consumer contracts.
- **Provider-driven**: Provider publishes its API spec. Consumers test against it.

Consumer-driven contracts work well in microservices where consumers have diverse needs. Provider-driven contracts are simpler when there's one canonical API.

## Versioning

When a contract changes, both sides need to update. Semantic versioning for APIs helps: breaking changes bump the major version. Contract tests verify backward compatibility.
