---
source: ai-generated
---

# Clean Architecture

**Clean architecture** organizes code into concentric layers with a strict dependency rule: dependencies point inward. The innermost layer (entities) knows nothing about the outer layers (frameworks, UI, databases).

## The Layers

1. **Entities**: core business objects and rules. Framework-independent.
2. **Use Cases**: application-specific business rules. Orchestrate entities.
3. **Interface Adapters**: controllers, presenters, gateways. Convert between use case format and external format.
4. **Frameworks & Drivers**: Express, PostgreSQL, React. The outermost, most volatile layer.

## Dependency Rule

Source code dependencies always point inward. The inner layers define interfaces; the outer layers implement them. This is the same principle as [[arch-003]] (hexagonal architecture) expressed with different vocabulary.

## Practical Structure

A typical project layout:

- `domain/` — entities, value objects, domain services
- `application/` — use cases, input/output ports
- `infrastructure/` — database adapters, HTTP clients, message brokers
- `presentation/` — REST controllers, GraphQL resolvers, CLI handlers

The `application/` layer depends only on `domain/`. The `infrastructure/` layer depends on `application/` and `domain/`. The `presentation/` layer depends on `application/`.

## Trade-offs

Clean architecture adds indirection. For a simple CRUD service, the ceremony of use case classes, input DTOs, and output DTOs may not pay for itself. For services with complex business logic, the testability and replaceability benefits are substantial.

See [[arch-004]] for the domain modeling patterns that live at the center of a clean architecture.
