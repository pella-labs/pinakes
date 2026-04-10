# Domain Model Patterns

## Anemic vs. Rich Domain Model

### Anemic Domain Model
Entities are just data holders. Logic lives in "service" classes. Martin Fowler calls this an anti-pattern.

```typescript
// Anemic — logic in service, not entity
class OrderService {
  addItem(order: Order, item: Item) {
    order.items.push(item);
    order.total = order.items.reduce((sum, i) => sum + i.price, 0);
  }
}
```

### Rich Domain Model
Entities encapsulate both data and behavior.

```typescript
// Rich — logic in entity
class Order {
  addItem(item: Item): void {
    if (this.status !== 'draft') throw new Error('Cannot modify');
    this.items.push(item);
    this.recalculateTotal();
  }
}
```

## When Anemic Is OK

- Simple CRUD with no invariants
- Rapid prototyping
- Very thin domains

## When Rich Is Required

- Complex business rules
- Invariants that must be enforced
- Multiple consumers of the same logic

See [[arch-006]], [[arch-019]].
