---
source: ai-generated
confidence: ambiguous
---
# Aggregate Design Rules

## Vaughn Vernon's Rules

1. **Design small aggregates.** An aggregate should be as small as possible while maintaining invariants.
2. **Reference other aggregates by ID, not by object reference.**
3. **Use eventual consistency between aggregates.** Don't try to make cross-aggregate changes atomic.
4. **Modify one aggregate per transaction.**

## Sizing Heuristic

If your aggregate has more than 3-4 entities, it's probably too big. Split it.

## Example: Order Aggregate

```typescript
class Order {
  readonly id: OrderId;
  private items: OrderItem[];  // value objects
  private status: OrderStatus;

  addItem(item: OrderItem): void {
    if (this.status !== 'draft') throw new Error('Cannot modify submitted order');
    if (this.items.length >= 50) throw new Error('Too many items');
    this.items.push(item);
  }

  submit(): void {
    if (this.items.length === 0) throw new Error('Empty order');
    this.status = 'submitted';
    this.addEvent(new OrderSubmitted(this.id, Date.now()));
  }
}
```

The `Order` is the aggregate root. `OrderItem` is a value object owned by the aggregate.

See [[arch-006]], [[arch-005]].
