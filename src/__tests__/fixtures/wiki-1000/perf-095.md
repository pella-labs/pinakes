---
title: Service Level Objectives in Practice
tags: [slo, reliability, operations]
---
# Service Level Objectives in Practice

## Choosing the Right Window

Rolling windows (7-day, 30-day) are better than calendar windows because they don't reset to 100% at month boundaries, hiding recent degradation.

## Multi-SLO Services

Most services need multiple SLOs:

- **Availability SLO**: 99.9% of requests return a non-5xx response
- **Latency SLO**: 99% of requests complete in <500ms
- **Correctness SLO**: 99.99% of responses contain correct data

## SLO Dashboard Components

A good SLO dashboard shows:

1. Current SLO compliance (percentage)
2. Error budget remaining (percentage and absolute time)
3. Budget burn rate (current vs sustainable)
4. Time series of SLI over the window
5. Alert status for burn rate thresholds

## Common Pitfalls

- Setting SLOs without measuring the baseline first
- Making SLOs too tight (100% is not an SLO, it's an impossibility)
- Not getting stakeholder buy-in on the consequences of budget exhaustion
- Measuring SLOs at the wrong point (server-side vs client-side)
- Having too many SLOs (3-5 per service is plenty)

## SLO Review Cadence

Review SLOs quarterly:
- Are they still meaningful?
- Are they too tight or too loose?
- Have user expectations changed?
- Have we consistently met or missed them?

See [[perf-020]] for SLO fundamentals and [[perf-021]] for error budget policies.
