# Clean Architecture

## Dependency Rule

Dependencies point inward. Inner layers know nothing about outer layers.

## Layers (Inside Out)

1. **Entities** — enterprise business rules
2. **Use Cases** — application-specific business rules
3. **Interface Adapters** — controllers, presenters, gateways
4. **Frameworks & Drivers** — web framework, DB, UI

## Comparison with Hexagonal

Clean architecture and **hexagonal architecture** are philosophically similar. The main difference is that Clean Architecture names four explicit layers, while hexagonal is more about the port/adapter metaphor.

## In Practice

Most teams use a simplified version:

```
src/
  domain/          # entities, value objects, domain services
  application/     # use cases, DTOs, ports
  infrastructure/  # adapters (DB, HTTP clients, message brokers)
  presentation/    # controllers, serializers
```

## Testing Strategy

- Unit test domain and use cases with zero infrastructure
- Integration test adapters against real databases
- E2E test through the presentation layer

See [[arch-009]], [[testing-integration]].
