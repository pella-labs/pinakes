# Layered Architecture

## Traditional Layers

The classic **layered architecture** organizes code into horizontal layers:

1. **Presentation** — UI, API controllers
2. **Business Logic** — domain rules, workflows
3. **Data Access** — repositories, ORM
4. **Database** — storage

## Rules

- Each layer depends only on the layer directly below
- Skip-layer calls (presentation → data access) are prohibited
- Lower layers don't know about upper layers

## Problems

- Tends toward **anemic domain models** (business logic migrates to "service" classes)
- Rigid layering can force unnecessary abstractions
- Hard to test business logic without pulling in the data layer

## Evolution

Most modern architectures (hexagonal, clean, onion) evolved from layered architecture by inverting the dependency direction — making the domain the center, not a middle layer.

See [[arch-009]], [[arch-010]].
