# Contract Testing with Pact

**Contract testing** verifies that two services can communicate correctly without requiring both to be running simultaneously. Pact is the most widely adopted framework for this pattern.

## How Pact Works

The consumer (client) writes tests defining what it expects from the provider (server). These expectations become a **contract** (pact file). The provider then verifies it can fulfill that contract.

```typescript
// Consumer side
const interaction = {
  state: 'a user exists',
  uponReceiving: 'a request for user details',
  withRequest: {
    method: 'GET',
    path: '/api/users/1',
  },
  willRespondWith: {
    status: 200,
    body: {
      id: 1,
      name: like('Alice'),
      email: like('alice@example.com'),
    },
  },
};
```

## Benefits Over E2E Tests

- **Speed**: No need to deploy the full stack
- **Independence**: Teams can verify contracts asynchronously
- **Specificity**: Failures point directly to the broken contract
- **CI-friendly**: Runs in seconds, not minutes

## Pact Broker

The **Pact Broker** stores and versions contracts. It enables can-i-deploy checks before pushing to production, ensuring that incompatible changes never reach prod.

See [[test-022]] for API contract testing patterns beyond Pact.
