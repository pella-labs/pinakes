# State Machine Pattern

## When to Use

When an entity has well-defined states and transitions between them. Orders, payments, user accounts, CI/CD pipelines.

## Implementation

```typescript
type OrderState = 'draft' | 'submitted' | 'paid' | 'shipped' | 'delivered' | 'cancelled';

const transitions: Record<OrderState, OrderState[]> = {
  draft: ['submitted', 'cancelled'],
  submitted: ['paid', 'cancelled'],
  paid: ['shipped', 'cancelled'],
  shipped: ['delivered'],
  delivered: [],
  cancelled: [],
};

function transition(current: OrderState, next: OrderState): OrderState {
  if (!transitions[current].includes(next)) {
    throw new Error(`Invalid transition: ${current} -> ${next}`);
  }
  return next;
}
```

## Libraries

- **XState** (TypeScript) — visual statecharts, great tooling
- **Robot** — lightweight, functional
- **Custom** — for simple state machines, a lookup table is enough

## Persistence

Store the current state in the DB. The transition table lives in code. On load, validate that the stored state is a valid state.

See [[arch-006]], [[arch-043]].
