# Hexagonal Architecture with TypeScript Modules

Practical file structure for a medium-sized Node.js service.

```
src/
  domain/
    model/
      order.ts              # Order aggregate
      order-item.ts         # Value object
      money.ts              # Value object
    ports/
      in/
        create-order.ts     # Input port (use case interface)
        cancel-order.ts
      out/
        order-repository.ts # Output port
        payment-gateway.ts  # Output port
    services/
      pricing-service.ts    # Domain service
    events/
      order-submitted.ts    # Domain event

  application/
    use-cases/
      create-order.ts       # Implements input port
      cancel-order.ts
    dto/
      create-order-dto.ts

  infrastructure/
    adapters/
      in/
        http-controller.ts  # Driving adapter
        cli-handler.ts
      out/
        pg-order-repo.ts    # Driven adapter
        stripe-gateway.ts
    config/
      database.ts
      app.ts

  main.ts                   # Composition root
```

No magic. No DI framework. Just interfaces and constructor injection.

See [[arch-009]], [[arch-096]].
