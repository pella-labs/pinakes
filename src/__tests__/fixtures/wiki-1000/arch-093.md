# Data Transfer Objects

## What They Are

A **DTO** is a simple object that carries data between processes or layers. It has no behavior — just fields.

## Why Use Them

- Decouple your domain model from your API contract
- Control what data is exposed to clients
- Optimize payload size per use case
- Validate input at the boundary

## Example

```typescript
// Domain entity (rich behavior)
class Order {
  readonly id: OrderId;
  private items: OrderItem[];
  private status: OrderStatus;
  submit(): void { /* ... */ }
}

// DTO (data only)
interface OrderDTO {
  id: string;
  items: { sku: string; quantity: number; price: number }[];
  status: string;
  totalCents: number;
}

// Mapper
function toDTO(order: Order): OrderDTO {
  return {
    id: order.id.value,
    items: order.items.map(i => ({ sku: i.sku, quantity: i.qty, price: i.price })),
    status: order.statusName,
    totalCents: order.total.cents,
  };
}
```

## Don't Overdo It

For simple CRUD, the domain model and DTO might be identical. Don't create a DTO just because "you're supposed to."

See [[arch-010]], [[api-rest-design]].
