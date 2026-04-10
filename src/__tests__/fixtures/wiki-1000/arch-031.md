# Dependency Injection

## What It Is

**Dependency injection** (DI) supplies an object's dependencies from the outside rather than having the object create them itself.

## Types

- **Constructor injection** — pass dependencies via constructor (preferred)
- **Property injection** — set dependencies on public properties (testing convenience)
- **Method injection** — pass dependencies as method parameters (rare)

## Without DI

```typescript
class OrderService {
  private repo = new PostgresOrderRepository();  // hard-coded dependency
  private emailer = new SmtpEmailService();       // hard-coded
}
```

## With DI

```typescript
class OrderService {
  constructor(
    private repo: OrderRepository,      // interface
    private emailer: EmailService,      // interface
  ) {}
}

// Composition root
const service = new OrderService(
  new PostgresOrderRepository(db),
  new SmtpEmailService(smtpConfig),
);
```

## DI Containers

Frameworks like InversifyJS, tsyringe, or NestJS's built-in DI handle wiring automatically. For small projects, manual wiring at the composition root is simpler.

See [[arch-030]], [[arch-009]].
