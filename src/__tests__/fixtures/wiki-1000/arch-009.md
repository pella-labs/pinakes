# Hexagonal Architecture

## Ports and Adapters

Also called **ports and adapters** architecture. The core idea: the domain logic is at the center, surrounded by ports (interfaces) and adapters (implementations).

## Structure

```
        [HTTP Adapter]  [CLI Adapter]
              |               |
              v               v
        +--[Input Port]---[Input Port]--+
        |                               |
        |       DOMAIN LOGIC            |
        |                               |
        +--[Output Port]--[Output Port]-+
              |                |
              v                v
        [DB Adapter]    [Email Adapter]
```

## Why It Matters

- **Testability** — swap real adapters for test doubles
- **Framework independence** — the domain doesn't know about Express, Fastify, etc.
- **Adapter swappability** — switch from Postgres to MySQL by writing a new adapter

## Rules

- Domain code never imports from adapter packages
- Ports are defined in the domain layer as interfaces
- Adapters implement ports and live in an outer ring

See [[arch-010]], [[arch-006]], [[testing-integration]].
