# Domain-Driven Design Primer

## Strategic Design

**DDD** is about aligning software structure with business domains. The key strategic patterns:

- **Bounded Context** — a linguistic and model boundary. Inside a BC, terms have precise meaning.
- **Ubiquitous Language** — the shared vocabulary between developers and domain experts within a BC.
- **Context Map** — documents how BCs relate to each other (partnership, customer-supplier, conformist, ACL, etc.)

## Tactical Patterns

### Entities
Objects with identity that persists across state changes. An `Order` is an entity — it has an ID.

### Value Objects
Immutable objects defined by their attributes, not identity. A `Money(100, "USD")` is a value object.

### Aggregates
A cluster of entities and value objects treated as a single unit for data changes. One entity is the **aggregate root**.

### Repositories
Provide collection-like access to aggregates. Hide persistence details.

### Domain Services
Operations that don't naturally belong to an entity or value object.

## Common Mistakes

- Applying DDD to CRUD apps (overkill)
- Ignoring the ubiquitous language (the whole point)
- Making aggregates too large

See [[arch-007]], [[arch-008]].
