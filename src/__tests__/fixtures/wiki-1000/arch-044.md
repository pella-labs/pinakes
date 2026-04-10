# Observer Pattern and Event Bus

## Observer Pattern

An object (subject) maintains a list of dependents (observers) and notifies them of state changes.

## Event Bus

A centralized event bus decouples publishers from subscribers:

```typescript
class EventBus {
  private handlers = new Map<string, Set<Function>>();

  on(event: string, handler: Function): void {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(handler);
  }

  off(event: string, handler: Function): void {
    this.handlers.get(event)?.delete(handler);
  }

  emit(event: string, data: unknown): void {
    for (const handler of this.handlers.get(event) ?? []) {
      handler(data);
    }
  }
}
```

## In-Process vs. Distributed

- **In-process** event bus: simple, synchronous or async, no persistence
- **Distributed** event bus (Kafka, RabbitMQ): durable, cross-service, ordered

## Gotcha

In-process event buses can create hidden coupling. If handler A fails, should the publisher know? Usually no — but then you lose error reporting.

See [[arch-003]], [[arch-022]].
