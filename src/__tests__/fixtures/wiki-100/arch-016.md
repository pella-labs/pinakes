# Modular Monolith

A **modular monolith** is a single deployable unit with well-defined internal module boundaries. It offers most of the organizational benefits of microservices without the operational complexity of distributed systems.

## Structure

Modules are organized by business domain, not by technical layer. Each module:

- Has its own public API (exported interfaces)
- Hides its internal implementation
- Owns its database tables (schema-level isolation)
- Communicates with other modules through defined contracts

```
src/
  modules/
    ordering/
      public/           # Exported interfaces only
        OrderService.ts
        types.ts
      internal/          # Hidden from other modules
        OrderRepository.ts
        OrderValidator.ts
        handlers/
      schema/
        orders.sql
    billing/
      public/
        BillingService.ts
      internal/
        ...
    shipping/
      public/
        ShipmentTracker.ts
      internal/
        ...
```

## Enforcing Boundaries

The key challenge is preventing modules from reaching into each other's internals. Enforcement strategies:

- **Barrel exports**: each module has an `index.ts` that re-exports only public interfaces
- **Lint rules**: ESLint rules that forbid importing from `*/internal/*`
- **Architecture tests**: automated tests that verify dependency direction (ArchUnit-style)
- **Package-level isolation**: each module is a workspace package with its own `package.json`

## When to Extract

A modular monolith is a great starting point. When a module needs independent scaling, a different deployment cadence, or a different tech stack, extract it into a microservice ([[arch-001]]). The module boundary is already clean — the extraction is straightforward.

This is the inverse of the [[arch-011]] strangler fig: instead of decomposing a legacy monolith, you start modular and extract as needed.
