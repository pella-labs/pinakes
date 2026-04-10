---
title: Testing State Machines
tags: [testing, state-machines, xstate]
created: 2025-11-01
---

# Testing State Machines

State machines provide a formal model for complex behavior. Testing them verifies all valid state transitions and guards against invalid ones.

## Testing Transitions

```typescript
describe('OrderStateMachine', () => {
  it('transitions from pending to confirmed', () => {
    const machine = createOrderMachine();
    const state = machine.transition('pending', 'CONFIRM');
    expect(state.value).toBe('confirmed');
  });

  it('does not allow skipping to shipped', () => {
    const machine = createOrderMachine();
    const state = machine.transition('pending', 'SHIP');
    expect(state.value).toBe('pending'); // unchanged
  });
});
```

## Testing Guards

Guards are conditions that must be true for a transition to occur:

```typescript
it('requires payment before confirmation', () => {
  const context = { paymentReceived: false };
  const state = machine.transition({ value: 'pending', context }, 'CONFIRM');
  expect(state.value).toBe('pending'); // guard blocks transition
});
```

## Testing Side Effects

State transitions may trigger actions (sending emails, updating databases). Test that the correct actions fire for each transition.

## Coverage of State Space

For complex machines, enumerate all reachable states and verify that every transition is tested. XState provides model-based testing utilities that generate test cases automatically from the machine definition.

See [[test-013]] for property-based testing of state machines.
