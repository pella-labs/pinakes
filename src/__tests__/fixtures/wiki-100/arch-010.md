# Saga Pattern

The **saga pattern** manages distributed transactions across multiple services without two-phase commit. Each step in the saga is a local transaction that publishes an event or triggers the next step. If a step fails, compensating transactions undo the preceding steps.

## Choreography-Based Saga

Each service listens for events and decides locally what to do next.

1. Order Service creates order, emits `OrderCreated`
2. Payment Service hears `OrderCreated`, charges the card, emits `PaymentProcessed`
3. Inventory Service hears `PaymentProcessed`, reserves stock, emits `StockReserved`
4. Shipping Service hears `StockReserved`, schedules delivery

If step 3 fails (out of stock), Inventory emits `StockReservationFailed`. Payment Service hears it and issues a refund. Order Service hears the refund event and marks the order as cancelled.

## Orchestration-Based Saga

A central **saga orchestrator** coordinates the steps:

```typescript
class OrderSaga {
  private steps: SagaStep[] = [
    {
      action: (ctx) => this.paymentService.charge(ctx.orderId, ctx.amount),
      compensate: (ctx) => this.paymentService.refund(ctx.orderId),
    },
    {
      action: (ctx) => this.inventoryService.reserve(ctx.orderId, ctx.items),
      compensate: (ctx) => this.inventoryService.release(ctx.orderId, ctx.items),
    },
    {
      action: (ctx) => this.shippingService.schedule(ctx.orderId, ctx.address),
      compensate: (ctx) => this.shippingService.cancel(ctx.orderId),
    },
  ];

  async execute(context: OrderContext): Promise<void> {
    const completed: SagaStep[] = [];
    for (const step of this.steps) {
      try {
        await step.action(context);
        completed.push(step);
      } catch {
        // Compensate in reverse order
        for (const done of completed.reverse()) {
          await done.compensate(context);
        }
        throw new SagaFailedError(context.orderId);
      }
    }
  }
}
```

## Choosing Between Them

Use **choreography** when the flow is simple (3-4 steps) and services are loosely coupled. Use **orchestration** when the flow is complex, has branching logic, or requires visibility into the overall transaction state.

Both approaches need robust [[monitoring-setup]] — failed sagas that leave partial state are the most dangerous failure mode in distributed systems. See also [[arch-002]] for the underlying event infrastructure.
