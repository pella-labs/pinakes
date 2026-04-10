# Chaos Engineering

**Chaos engineering** intentionally introduces failures into a system to verify its resilience. The goal is to find weaknesses before they cause outages.

## Principles

1. Define steady state behavior
2. Hypothesize that steady state continues during failures
3. Introduce real-world events: server crashes, network partitions, disk full
4. Look for differences between control and experiment

## Common Experiments

- Kill a random pod in Kubernetes
- Introduce network latency between services
- Simulate database connection exhaustion
- Fill up disk space
- Corrupt messages in a queue
- Terminate the primary database and verify failover

## Tools

- **Chaos Monkey** (Netflix) — kills random instances
- **Litmus** — Kubernetes-native chaos
- **Gremlin** — commercial platform
- **Toxiproxy** — simulate network conditions

## GameDay Practice

A **GameDay** is a scheduled chaos experiment with the whole team observing. It's a controlled environment to practice incident response. Run one monthly, starting with low-risk experiments and gradually increasing severity.

## Prerequisites

Before doing chaos engineering, you need:

- Observability (logs, metrics, traces)
- Automated recovery mechanisms
- Runbooks for known failure modes
- A way to quickly stop the experiment

Without these, chaos engineering is just breaking things. See [[test-017]] for load testing as a prerequisite.

## Starting Small

The biggest mistake teams make with chaos engineering is starting too aggressively. Don't begin by killing production databases. Start with non-critical services in staging environments.

A good progression for introducing chaos engineering to a team:

1. **Week 1-2**: Inject latency into a non-critical downstream service. Observe how the system handles slow responses. Verify timeouts and circuit breakers work.

2. **Week 3-4**: Kill a single instance of a stateless service behind a load balancer. Verify the load balancer routes around the failure and the service recovers when the instance restarts.

3. **Month 2**: Simulate database failover. Take the primary offline and verify the replica is promoted cleanly. Measure downtime.

4. **Month 3**: Run a full GameDay with the team. Inject multiple failures simultaneously and practice the incident response process.

Each experiment should have a hypothesis, a blast radius containment plan, and a way to immediately stop the experiment. Chaos engineering without guardrails is just breaking things and hoping for the best.

The cultural shift matters as much as the technical tooling. Teams need to feel safe reporting that their service failed a chaos test. If the response to a failure is blame rather than improvement, engineers will avoid running experiments.
