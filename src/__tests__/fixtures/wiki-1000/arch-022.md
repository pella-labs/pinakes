# Domain Events

## What They Are

A **domain event** represents something that happened in the domain that other parts of the system care about. They are named in past tense: `OrderPlaced`, `UserRegistered`, `PaymentFailed`.

## Publishing

```typescript
class Order {
  private events: DomainEvent[] = [];

  submit(): void {
    this.status = 'submitted';
    this.events.push(new OrderSubmitted(this.id, this.items, Date.now()));
  }

  pullEvents(): DomainEvent[] {
    const events = [...this.events];
    this.events = [];
    return events;
  }
}
```

## Handling

Subscribe to events at the application layer:

```typescript
class SendConfirmationOnOrderSubmitted {
  constructor(private emailService: EmailService) {}

  async handle(event: OrderSubmitted): Promise<void> {
    await this.emailService.sendOrderConfirmation(event.orderId);
  }
}
```

## Guidelines

- Events are immutable facts
- Don't put business logic in event handlers (keep it in the domain)
- Events cross bounded context boundaries via integration events

See [[arch-003]], [[arch-006]], [[arch-016]].
