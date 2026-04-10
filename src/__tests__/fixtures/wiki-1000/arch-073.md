# GraphQL Architecture

## Core Concepts

- **Schema** — typed contract defining available data
- **Queries** — read data (client specifies exactly what it needs)
- **Mutations** — write data
- **Subscriptions** — real-time updates via WebSocket

## Benefits

- No over-fetching (client asks for exactly the fields it needs)
- No under-fetching (one query can span multiple resources)
- Self-documenting (introspection)
- Strong typing

## Challenges

- **N+1 problem** — naive resolvers make N+1 database queries. Use DataLoader.
- **Authorization** — field-level auth is complex
- **Caching** — HTTP caching doesn't work (everything is POST to one endpoint)
- **Query complexity** — malicious queries can be expensive. Use depth limiting and cost analysis.

## When to Use

- Multiple frontend clients with different data needs
- Rapidly evolving APIs
- Data aggregation from multiple backends

## When Not to Use

- Simple APIs with one consumer
- File upload heavy (GraphQL is awkward with binary data)
- Teams without GraphQL experience (learning curve is real)

See [[api-rest-design]], [[frontend-react]], [[arch-033]].
