# Specification Pattern

The **specification pattern** encapsulates business rules as composable, reusable objects.

## Interface

```typescript
interface Specification<T> {
  isSatisfiedBy(candidate: T): boolean;
  and(other: Specification<T>): Specification<T>;
  or(other: Specification<T>): Specification<T>;
  not(): Specification<T>;
}
```

## Example

```typescript
class IsActiveCustomer implements Specification<Customer> {
  isSatisfiedBy(c: Customer): boolean {
    return c.status === 'active';
  }
}

class HasMinimumPurchases implements Specification<Customer> {
  constructor(private min: number) {}
  isSatisfiedBy(c: Customer): boolean {
    return c.totalPurchases >= this.min;
  }
}

// Compose
const eligibleForDiscount = new IsActiveCustomer()
  .and(new HasMinimumPurchases(5));

const eligible = customers.filter(c => eligibleForDiscount.isSatisfiedBy(c));
```

## Use Cases

- Filtering collections
- Validation rules
- Query criteria (translate specs to SQL)
- Authorization policies

See [[arch-006]].
