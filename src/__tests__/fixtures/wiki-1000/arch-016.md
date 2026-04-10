# Saga Pattern

## Distributed Transactions Without 2PC

In a microservices world, you can't wrap a cross-service operation in a single database transaction. The **saga pattern** manages distributed transactions as a sequence of local transactions, each with a compensating action.

## Orchestration vs. Choreography

### Orchestration
A central **saga orchestrator** tells each service what to do and handles failures.

### Choreography
Each service listens for events and decides what to do next. No central coordinator.

## Example: Order Saga (Orchestration)

1. Create Order → `order-service`
2. Reserve Inventory → `inventory-service`
3. Process Payment → `payment-service`
4. Confirm Order → `order-service`

If step 3 fails:
- Compensate step 2: Release Inventory
- Compensate step 1: Cancel Order

## Choreography Pitfalls

- Hard to understand the overall flow
- Difficult to handle out-of-order events
- Debugging is painful without good tracing

Most teams start with choreography and switch to orchestration when complexity grows.

See [[arch-003]], [[arch-001]], [[database-sharding]].
