---
title: Chaos Engineering Fundamentals
tags: [chaos, resilience, testing]
---
# Chaos Engineering Fundamentals

## Principle

**Chaos engineering** is the discipline of experimenting on a system to build confidence in its ability to withstand turbulent conditions in production. It is not about breaking things for fun.

## The Chaos Process

1. Define the **steady state** (normal behavior in measurable terms)
2. Hypothesize that steady state will continue during the experiment
3. Introduce a fault (network delay, pod kill, disk fill)
4. Observe whether steady state was maintained
5. If not, you found a weakness — fix it

## Types of Experiments

- **Network**: inject latency, drop packets, partition
- **Compute**: kill processes, fill CPU, exhaust memory
- **Storage**: fill disk, corrupt files, slow I/O
- **Application**: inject exceptions, slow dependencies
- **DNS**: fail or slow DNS resolution

## Blast Radius Control

Start small. Run experiments in staging first, then progressively move to production with limited scope. Use **abort conditions** that automatically stop the experiment if metrics cross thresholds.

## GameDay Practice

Run scheduled **GameDays** where teams practice incident response against controlled failures. This builds muscle memory for real incidents and validates runbooks.

See [[perf-023]] for incident management.

## Tools

### Chaos Monkey (Netflix)
Randomly terminates virtual machine instances. Tests that services survive instance failure.

### Litmus (CNCF)
Kubernetes-native chaos engineering. Injects faults into pods, nodes, and network.

### Gremlin
Commercial chaos platform with a wide experiment library and safety controls.

### Toxiproxy (Shopify)
TCP proxy that simulates network conditions: latency, bandwidth, connection reset. Useful for integration testing.

```bash
# Create a proxy for Redis
toxiproxy-cli create redis_proxy -l localhost:26379 -u localhost:6379

# Add 500ms latency
toxiproxy-cli toxic add redis_proxy -t latency -a latency=500

# Cut the connection entirely
toxiproxy-cli toxic add redis_proxy -t timeout -a timeout=0
```

## Chaos Engineering Maturity

### Level 1: Manual experiments in staging
Run ad-hoc failure injection in non-production environments.

### Level 2: Automated experiments in staging
Scheduled experiments with automated steady-state verification.

### Level 3: Automated experiments in production (limited blast radius)
Target a small percentage of traffic. Automatic abort on SLO violation.

### Level 4: Continuous chaos in production
Always-on failure injection at low rates. The system proves its resilience continuously rather than periodically.

Most organizations should aim for Level 2 and progress to Level 3 only after achieving strong observability and incident response maturity.
