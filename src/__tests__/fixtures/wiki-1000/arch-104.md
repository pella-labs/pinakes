# Choreography vs Orchestration

Decision record on when to use each.

## Choreography

Each service reacts to events autonomously. No central coordinator.

**Pros**:
- Simple for 2-3 services
- Naturally decoupled
- No single point of failure

**Cons**:
- Hard to understand the flow as it grows
- Difficult to add cross-cutting concerns (timeouts, compensation)
- Testing the full flow requires event-trace analysis

## Orchestration

A central orchestrator (process manager) directs the flow.

**Pros**:
- Clear, visible flow
- Easy to add timeout and compensation logic
- Centralized monitoring

**Cons**:
- Orchestrator is a single point of failure (mitigate with HA)
- Tighter coupling to orchestrator
- Can become a god class

## Decision Heuristic

- 2-3 services, simple flow → choreography
- 4+ services, complex branching → orchestration
- Need for timeouts/compensation → orchestration
- Event-first architecture → choreography with monitoring

See [[arch-016]], [[arch-077]], [[arch-003]].
