---
source: ai-generated
---
# Value Objects

## Definition

A **value object** is defined entirely by its attributes. Two value objects with the same attributes are equal, regardless of identity.

## Properties

- **Immutable** — once created, never changed
- **Self-validating** — invalid state is impossible
- **Side-effect free** — methods return new instances

## Examples

```typescript
class Money {
  constructor(
    readonly amount: number,
    readonly currency: string,
  ) {
    if (amount < 0) throw new Error('Negative amount');
    if (!['USD', 'EUR', 'GBP'].includes(currency)) throw new Error('Unknown currency');
  }

  add(other: Money): Money {
    if (this.currency !== other.currency) throw new Error('Currency mismatch');
    return new Money(this.amount + other.amount, this.currency);
  }

  equals(other: Money): boolean {
    return this.amount === other.amount && this.currency === other.currency;
  }
}
```

## When to Use

Replace primitive obsession with value objects:
- `string` email → `EmailAddress`
- `number` price → `Money`
- `string` phone → `PhoneNumber`

See [[arch-006]], [[arch-008]].
