---
source: extracted
---
# Monolith-First Strategy

## Rationale

Martin Fowler's advice: **don't start with microservices**. Build a well-structured monolith first, then extract services when you understand the domain boundaries.

## The Modular Monolith

A **modular monolith** enforces module boundaries at the code level (separate packages/namespaces, explicit public APIs) without the operational overhead of network calls. You get most of the organizational benefits with none of the distributed systems headaches.

### Module Boundary Rules

- No cross-module database access
- Communication via well-defined interfaces (events or direct calls within-process)
- Each module owns its tables

## Extraction Triggers

Extract a module into a service when:
1. It needs to scale independently
2. It has a fundamentally different deployment cadence
3. A separate team will own it full-time

See [[arch-001]], [[arch-025]].
