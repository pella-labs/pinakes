# Strangler Fig Migration

## Concept

Named after the strangler fig tree that grows around its host until the host dies. Apply this to legacy systems: incrementally replace functionality without a big-bang rewrite.

## Steps

1. **Identify** a self-contained piece of functionality in the legacy system
2. **Build** the replacement in the new system
3. **Route** traffic to the new implementation (use a proxy/router)
4. **Verify** the new implementation behaves correctly
5. **Decommission** the old code path
6. Repeat

## Implementation

```
Client → [Router/Proxy] → New Service (feature A, B)
                        → Legacy System (everything else)
```

The router can be:
- An API gateway with path-based routing
- A feature flag system
- A DNS-level split

## Key Principles

- Never modify the legacy system (except to add routing hooks)
- Each increment must be independently deployable and rollbackable
- Monitor both old and new paths during transition
- Don't underestimate data migration — it's usually the hardest part

See [[arch-002]], [[arch-013]].
