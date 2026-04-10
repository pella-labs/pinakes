# Modular Monolith

## The Best of Both Worlds?

A **modular monolith** is a single deployable unit with strict internal module boundaries. You get the simplicity of a monolith with the organizational clarity of microservices.

## Structure

```
src/
  modules/
    orders/
      public/           # exported API (interfaces, DTOs)
      internal/          # implementation (services, repos, entities)
      events/            # published events
      tests/
    inventory/
      public/
      internal/
      events/
      tests/
    shipping/
      ...
  shared/
    kernel/              # truly shared types (Money, EntityId)
    infrastructure/      # database, messaging
```

## Enforcement

Use architectural fitness functions to enforce boundaries:
- **ArchUnit** (Java) or **ts-arch** (TypeScript) to ban cross-module imports
- Module dependency graphs in CI
- Each module has its own database schema (same DB, separate tables/schemas)

## When to Extract

A module becomes a service when:
- It needs independent scaling
- It has a different fault domain
- A separate team owns it

See [[arch-002]], [[arch-001]].
