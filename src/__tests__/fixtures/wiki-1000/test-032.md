
# Testing Microservices

Microservices multiply the testing challenge. Each service needs its own tests, and the interactions between services need contract and integration tests.

## Testing Pyramid for Microservices

The traditional testing pyramid still applies, but with an extra layer:

1. Unit tests (per service)
2. Integration tests (per service, with real database)
3. Contract tests (between services)
4. Component tests (single service, mocked dependencies)
5. End-to-end tests (full system)

## Component Testing

Test a single service with its real database but mocked external dependencies:

```typescript
describe('OrderService component', () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await TestApp.create({
      database: 'real',
      paymentService: 'mock',
      inventoryService: 'mock',
    });
  });

  it('creates order and reserves inventory', async () => {
    const response = await app.post('/orders', { items: [{ sku: 'A1', qty: 2 }] });
    expect(response.status).toBe(201);
    expect(app.mocks.inventoryService.lastCall).toMatchObject({
      sku: 'A1',
      qty: 2,
    });
  });
});
```

## Service Virtualization

When real downstream services aren't available, use **service virtualization** tools like WireMock or MockServer to simulate their behavior.

## Testing in Production

For microservices, some testing is best done in production using canary deployments, feature flags, and shadow traffic. This doesn't replace pre-production testing but augments it.

See [[test-004]] for Pact contract testing between services.
