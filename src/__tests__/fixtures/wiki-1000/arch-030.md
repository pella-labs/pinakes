# SOLID Principles

## Single Responsibility (SRP)

A class should have one reason to change. Not "do one thing" — rather, be responsible to one actor/stakeholder.

## Open/Closed (OCP)

Open for extension, closed for modification. Add behavior by adding new code, not changing existing code. Strategy and decorator patterns help here.

## Liskov Substitution (LSP)

Subtypes must be substitutable for their base types without altering program correctness. If `Square extends Rectangle` breaks when you set width and height independently, LSP is violated.

## Interface Segregation (ISP)

Don't force clients to depend on interfaces they don't use. Prefer many small interfaces over one fat interface.

## Dependency Inversion (DIP)

High-level modules should not depend on low-level modules. Both should depend on abstractions. This is the core principle behind hexagonal and clean architecture.

See [[arch-009]], [[arch-010]], [[arch-019]].
