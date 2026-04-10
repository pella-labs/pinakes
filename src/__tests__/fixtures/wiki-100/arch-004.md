# Domain-Driven Design

**Domain-driven design** (DDD) is a software design approach that centers the architecture on the business domain. It provides a shared language between developers and domain experts, and structural patterns for managing complexity.

## Strategic Design

### Bounded Contexts

A **bounded context** is the boundary within which a domain model is consistent. The same real-world concept (e.g., "customer") may have different representations in different contexts — a billing context cares about payment methods, while a shipping context cares about addresses.

Bounded contexts map naturally to [[arch-001]] service boundaries.

### Context Mapping

When bounded contexts interact, you need a context map. Common relationships:

- **Shared Kernel**: two contexts share a subset of the model. Tight coupling, use sparingly.
- **Customer-Supplier**: upstream context publishes, downstream consumes. The upstream team accommodates the downstream team's needs.
- **Conformist**: downstream accepts whatever the upstream publishes. No negotiation.
- **Anti-corruption Layer (ACL)**: downstream translates upstream models into its own language. Essential when integrating with legacy systems.

## Tactical Patterns

### Aggregates

An **aggregate** is a cluster of domain objects treated as a unit for data changes. It has a root entity and enforces invariants within its boundary. Other objects reference the aggregate by its root ID only.

### Value Objects

**Value objects** are immutable and defined by their attributes, not identity. `Money(100, 'USD')`, `EmailAddress('user@example.com')`, `DateRange(start, end)`.

### Domain Events

Events that originate from aggregate state changes. `OrderPlaced`, `InventoryDepleted`. See [[arch-002]] for event infrastructure patterns.

### Repositories

Repositories provide collection-like interfaces for accessing aggregates. They abstract the persistence mechanism — see [[database-patterns]] for implementation patterns.

## When to Use DDD

DDD is most valuable when the domain is complex and the business logic is the primary source of software complexity. For CRUD-heavy applications with simple business rules, DDD adds ceremony without proportional benefit.
