---
title: Observability Maturity Model
tags: [observability, maturity, strategy]
created: 2025-12-10
---
# Observability Maturity Model

## Level 0: Reactive

- No monitoring beyond host-level metrics
- Issues discovered by users or when things crash
- No alerting; someone checks manually
- Logs exist but aren't aggregated

## Level 1: Basic Monitoring

- Infrastructure metrics (CPU, memory, disk)
- Application health checks
- Basic alerting on host-level thresholds
- Centralized log aggregation
- Incident response is ad-hoc

## Level 2: Proactive Monitoring

- Application-level metrics (RED method)
- Structured logging with correlation IDs
- Alert on symptoms, not causes
- Runbooks for common alerts
- Post-mortems for significant incidents

## Level 3: Distributed Observability

- Distributed tracing across services
- SLOs defined and tracked
- Error budgets driving engineering priorities
- Dashboards-as-code
- Synthetic monitoring

## Level 4: Data-Driven Operations

- Anomaly detection on key metrics
- Automated remediation for known failures
- Chaos engineering practice
- Observability embedded in development workflow
- Cost-optimized telemetry pipeline

## Progression Strategy

Move one level at a time. Each level builds on the previous one. Attempting to jump from Level 0 to Level 3 usually results in a half-implemented mess that nobody trusts.

The most impactful investment at each level:
- L0 → L1: centralized logging and basic alerts
- L1 → L2: application metrics and SLOs
- L2 → L3: distributed tracing
- L3 → L4: automation and chaos engineering

See [[perf-020]] for SLOs and [[perf-036]] for chaos engineering.

## Assessing Your Current Level

Ask these questions to determine your maturity level:

### Detection
- How do you typically learn about outages? (Users? Alerts? Dashboards?)
- What is your mean time to detection (MTTD)?

### Diagnosis
- Can you identify which service caused an issue within 5 minutes?
- Can you trace a request end-to-end across all services?
- Do you have runbooks for common failure modes?

### Response
- Do you have a defined incident management process?
- Are post-mortems conducted and action items tracked?
- Is on-call sustainable (< 2 pages per shift)?

### Prevention
- Are SLOs defined and tracked for critical services?
- Do you practice chaos engineering?
- Is observability part of the development workflow (not an afterthought)?

## Investment Priorities by Level

For each maturity level, there is one investment that provides the most leverage:

- **Level 0**: Deploy centralized logging (ELK or Loki). Immediate visibility.
- **Level 1**: Define SLOs for top 3 services. Creates shared language for reliability.
- **Level 2**: Implement distributed tracing. Transforms debugging from guesswork to science.
- **Level 3**: Build a chaos engineering practice. Proves resilience proactively instead of reactively.

Each of these investments takes 1-3 months to implement well. Don't try to do everything at once.
