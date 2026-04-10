---
source: ai-generated
confidence: ambiguous
---

# Hexagonal Architecture

Hexagonal architecture (ports and adapters) isolates the core domain logic from external concerns like databases, HTTP, and messaging. The **domain** sits at the center and defines **ports** — interfaces that describe what the domain needs. **Adapters** implement those ports for specific technologies.

## The Ports

### Driving Ports (Primary)

Driving ports are the entry points into the application. They define the use cases the domain exposes:

```typescript
// A driving port — defines what the application can do
interface OrderService {
  placeOrder(command: PlaceOrderCommand): Promise<OrderId>;
  cancelOrder(orderId: OrderId, reason: string): Promise<void>;
  getOrderStatus(orderId: OrderId): Promise<OrderStatus>;
}
```

### Driven Ports (Secondary)

Driven ports are what the domain needs from the outside world:

```typescript
// A driven port — defines what the domain needs
interface OrderRepository {
  save(order: Order): Promise<void>;
  findById(id: OrderId): Promise<Order | null>;
  findByCustomer(customerId: CustomerId): Promise<Order[]>;
}

interface PaymentGateway {
  charge(amount: Money, method: PaymentMethod): Promise<PaymentResult>;
  refund(paymentId: PaymentId): Promise<RefundResult>;
}
```

## The Adapters

Adapters are the concrete implementations. A `PostgresOrderRepository` implements `OrderRepository`. An `StripePaymentGateway` implements `PaymentGateway`. An `ExpressHttpAdapter` drives the `OrderService`.

The key insight: you can swap adapters without touching domain logic. Replace Postgres with DynamoDB, Stripe with Braintree, Express with Fastify — the domain doesn't know or care.

## Testing Benefits

This architecture makes testing natural. Unit tests use in-memory adapters. Integration tests use real adapters against test infrastructure. The domain logic is tested in isolation, with no database or network involved.

## Relationship to Other Patterns

Hexagonal architecture is compatible with [[arch-005]] (CQRS), [[arch-004]] (DDD), and [[arch-001]] (microservices). In fact, each microservice ideally has its own hexagonal structure internally.
