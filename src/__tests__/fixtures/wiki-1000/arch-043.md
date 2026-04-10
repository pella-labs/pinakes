# Command Pattern

## Intent

Encapsulate a request as an object, allowing parameterization, queuing, logging, and undo.

## Structure

```typescript
interface Command {
  execute(): Promise<void>;
  undo(): Promise<void>;
}

class AddItemToCartCommand implements Command {
  constructor(
    private cart: Cart,
    private item: CartItem,
  ) {}

  async execute(): Promise<void> {
    this.cart.addItem(this.item);
  }

  async undo(): Promise<void> {
    this.cart.removeItem(this.item.id);
  }
}
```

## Use Cases

- Undo/redo functionality
- Command queuing (execute later)
- Macro recording (compose multiple commands)
- Audit logging (log every command)

## In CQRS

Commands in CQRS are typically handled by a command handler, not the command itself. The command is a DTO; the handler contains the logic.

See [[arch-004]], [[arch-006]].
