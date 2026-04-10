# Testing Dependency Injection

**Dependency injection** makes code testable by allowing test doubles to be substituted for real implementations.

## Constructor Injection

```typescript
class OrderService {
  constructor(
    private readonly orderRepo: OrderRepository,
    private readonly emailService: EmailService,
  ) {}

  async createOrder(data: OrderData) {
    const order = await this.orderRepo.create(data);
    await this.emailService.sendConfirmation(order);
    return order;
  }
}

// In tests
it('sends confirmation email', async () => {
  const fakeRepo = { create: vi.fn().mockResolvedValue({ id: '1' }) };
  const fakeEmail = { sendConfirmation: vi.fn() };
  const service = new OrderService(fakeRepo, fakeEmail);

  await service.createOrder({ items: [] });
  expect(fakeEmail.sendConfirmation).toHaveBeenCalledWith({ id: '1' });
});
```

## Container-Based DI

DI containers add complexity. Test that the container resolves dependencies correctly and that scoped instances are properly isolated.

## Testing Without DI

If code uses static imports or singletons, testing is harder. You need module mocking:

```typescript
vi.mock('../email-service', () => ({
  sendEmail: vi.fn(),
}));
```

This is fragile. Prefer constructor injection when possible.
