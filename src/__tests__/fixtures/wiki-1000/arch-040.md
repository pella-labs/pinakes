---
source: ai-generated
---
# Eventual Consistency

## Definition

In an **eventually consistent** system, updates propagate asynchronously. Given enough time without new updates, all replicas converge to the same state.

## Consistency Models Spectrum

Strong consistency → Linearizability → Sequential → Causal → **Eventual** → No guarantee

## Coping Strategies

- **Read-your-writes** — after a write, the same client always sees its own update (session stickiness or read-from-primary)
- **Monotonic reads** — once you've seen a value, you never see an older value
- **Causal consistency** — if A causes B, everyone sees A before B

## UI Implications

- Show optimistic updates immediately, reconcile later
- Use loading states for cross-service data
- Display "saving..." indicators
- Handle conflicts with last-write-wins or user resolution

## Common Pitfalls

- Assuming immediate consistency when reading after writing to a different replica
- Not handling stale reads in cache layers
- Ignoring the user experience of eventual consistency

See [[arch-004]], [[database-sharding]], [[perf-caching]].
