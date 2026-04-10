---
source: ai-generated
---
# Event Collaboration Pattern

## Problem

Services need to work together without direct knowledge of each other.

## Solution

Services collaborate by exchanging **events**. Each service reacts to events from other services and publishes its own events. No service tells another what to do.

## Example: Order Fulfillment

```
OrderService publishes → OrderPlaced
  InventoryService subscribes, reserves stock, publishes → StockReserved
    PaymentService subscribes, processes payment, publishes → PaymentCollected
      ShippingService subscribes, creates shipment, publishes → ShipmentCreated
        NotificationService subscribes, sends confirmation email
```

No orchestrator. Each service knows only about the events it cares about.

## Requirements

- Events must carry enough context for consumers to act
- Consumers must be idempotent
- Monitoring must trace the full event chain
- Dead letter handling for failed events

## Limitations

The overall flow is implicit. You need good observability to understand and debug it. Consider adding an event flow diagram as documentation.

See [[arch-003]], [[arch-104]], [[arch-022]].
