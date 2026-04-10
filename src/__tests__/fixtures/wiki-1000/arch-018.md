# Factory Pattern in DDD

## Why Factories?

When creating a domain object involves complex logic, validation, or assembly from multiple sources, a **factory** keeps the construction logic out of the entity itself.

## Types

- **Factory Method** — a static method on the entity or a domain service
- **Abstract Factory** — creates families of related objects
- **Builder** — step-by-step construction with validation at the end

## Example

```typescript
class OrderFactory {
  constructor(
    private pricingService: PricingService,
    private inventoryChecker: InventoryChecker,
  ) {}

  async create(customerId: CustomerId, items: CartItem[]): Promise<Order> {
    // Validate inventory
    for (const item of items) {
      const available = await this.inventoryChecker.check(item.sku, item.qty);
      if (!available) throw new InsufficientInventoryError(item.sku);
    }

    // Calculate pricing
    const priced = await this.pricingService.price(items);

    // Construct aggregate
    return new Order(OrderId.generate(), customerId, priced, 'draft');
  }
}
```

## When to Use

Use a factory when object creation involves:
- Cross-aggregate validation
- External service calls
- Complex invariant checking

Don't use a factory for simple construction — a constructor is fine.

See [[arch-006]], [[arch-008]].
