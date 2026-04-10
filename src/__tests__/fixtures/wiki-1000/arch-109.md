# Saga Compensation Design

## Principles

Every forward step in a saga needs a **compensating action** that undoes its effect.

## Compensation Table

| Step | Forward Action | Compensating Action |
|---|---|---|
| 1 | Create Order | Cancel Order |
| 2 | Reserve Inventory | Release Inventory |
| 3 | Process Payment | Refund Payment |
| 4 | Ship Order | (cannot compensate — human process) |

## Non-Compensatable Steps

Some steps can't be undone (shipping, sending emails). Place these last in the saga to minimize the window for compensation.

## Semantic Undo

Compensation doesn't undo — it creates a new action. A refund is not "uncharging" — it's a new credit transaction. The original charge still happened in the audit trail.

## Timeout Handling

If a step times out, you don't know if it succeeded or failed. Options:
- Query the service for the current state
- Use idempotency keys and retry
- Compensate and re-run the whole saga

See [[arch-016]], [[arch-077]], [[arch-035]].
