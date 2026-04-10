# Chaos Engineering

## Netflix's Approach

**Chaos engineering** is the discipline of experimenting on a system to build confidence in its ability to withstand turbulent conditions in production.

## Principles

1. Build a hypothesis about steady-state behavior
2. Vary real-world events (server failure, network partition, resource exhaustion)
3. Run experiments in production (start small)
4. Automate experiments to run continuously

## Tools

- **Chaos Monkey** — randomly terminates instances
- **Litmus** — Kubernetes-native chaos
- **Gremlin** — commercial, broad attack surface
- **Toxiproxy** — simulate network conditions (latency, partitions)

## Game Days

Scheduled exercises where the team intentionally breaks things and practices incident response. Start with tabletop exercises, graduate to live experiments.

## Prerequisites

Before chaos engineering:
- Observability (you need to see the impact)
- Circuit breakers and fallbacks (you need graceful degradation)
- Runbooks (the team needs to know how to respond)

See [[monitoring-prometheus]], [[arch-014]], [[arch-054]].
