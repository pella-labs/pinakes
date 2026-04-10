# Ports and Adapters in TypeScript

## Defining Ports

Ports are TypeScript interfaces defined in the domain or application layer:

```typescript
// src/domain/ports/order-repository.ts
export interface OrderRepository {
  findById(id: OrderId): Promise<Order | null>;
  save(order: Order): Promise<void>;
}

// src/domain/ports/notification-service.ts
export interface NotificationService {
  notify(userId: UserId, message: string): Promise<void>;
}

// src/domain/ports/payment-gateway.ts
export interface PaymentGateway {
  charge(amount: Money, method: PaymentMethod): Promise<PaymentResult>;
}
```

## Implementing Adapters

```typescript
// src/infrastructure/adapters/drizzle-order-repository.ts
export class DrizzleOrderRepository implements OrderRepository {
  constructor(private db: DrizzleDatabase) {}
  // implementation
}

// src/infrastructure/adapters/ses-notification-service.ts
export class SesNotificationService implements NotificationService {
  constructor(private ses: SESClient) {}
  // implementation
}
```

## Wiring

```typescript
// src/composition-root.ts
const db = createDatabase(config.dbUrl);
const orderRepo = new DrizzleOrderRepository(db);
const notifications = new SesNotificationService(sesClient);
const paymentGateway = new StripePaymentAdapter(stripeClient);

const createOrderUseCase = new CreateOrderUseCase(orderRepo, notifications, paymentGateway);
```

See [[arch-009]], [[arch-031]].
