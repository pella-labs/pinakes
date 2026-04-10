# CQRS Pattern

## Overview

**Command Query Responsibility Segregation** separates the write model (commands) from the read model (queries). Each side can be optimized independently.

## When It Helps

- Read and write workloads differ by 10x or more
- You need different data shapes for display vs. mutation
- Combined with event sourcing for a full audit trail

## Basic Structure

```typescript
// Command side
interface CreateOrderCommand {
  customerId: string;
  items: OrderItem[];
}

// Query side
interface OrderSummaryQuery {
  orderId: string;
}

interface OrderSummaryView {
  orderId: string;
  customerName: string;
  totalFormatted: string;
  status: string;
}
```

## Pitfalls

- **Eventual consistency** between write and read models confuses users ("I just saved, where is it?")
- Adds complexity — don't use CQRS for simple CRUD
- Projection lag can mask bugs

See [[arch-003]], [[arch-005]].
