# Process Manager Pattern

## What It Is

A **process manager** (sometimes called a saga orchestrator) coordinates long-running business processes that span multiple aggregates or services.

## vs. Saga

The process manager pattern is more general than a saga. A saga has linear compensating steps; a process manager can handle complex branching logic.

## Example: Order Fulfillment

```typescript
class OrderFulfillmentProcess {
  private state: 'started' | 'inventory_reserved' | 'payment_processed' | 'shipped' | 'failed';

  async handle(event: DomainEvent): Promise<Command[]> {
    switch (this.state) {
      case 'started':
        if (event.type === 'InventoryReserved') {
          this.state = 'inventory_reserved';
          return [new ProcessPaymentCommand(this.orderId, this.amount)];
        }
        if (event.type === 'InventoryInsufficient') {
          this.state = 'failed';
          return [new CancelOrderCommand(this.orderId, 'out_of_stock')];
        }
        break;
      // ... more states
    }
    return [];
  }
}
```

## Persistence

The process manager's state must be persisted. If it crashes mid-process, it resumes from the last persisted state.

See [[arch-016]], [[arch-051]], [[arch-004]].
