---
source: extracted
---
# Decision Matrix: Architecture Style

## When to Choose What

| Style | Best For | Team Size | Complexity |
|---|---|---|---|
| Monolith | Early stage, small team | 2-8 | Low |
| Modular monolith | Growing team, clear domains | 5-20 | Medium |
| Microservices | Large org, independent teams | 20+ | High |
| Event-driven | Async workflows, loose coupling | 10+ | High |
| Serverless | Sporadic workloads, rapid prototyping | 2-10 | Medium |
| Micro frontends | Multiple frontend teams | 15+ | High |

## Decision Flowchart

1. Do you have >20 engineers? No → monolith or modular monolith
2. Do components scale differently? No → modular monolith
3. Do teams need independent deployment? No → modular monolith
4. Is eventual consistency acceptable? No → be very careful with microservices
5. Do you have platform engineering capacity? No → don't do microservices

## The Only Wrong Answer

Choosing an architecture style for reasons other than your actual constraints. "Netflix does microservices" is not a constraint. "We have 50 engineers who need to ship independently" is.

See [[arch-001]], [[arch-002]], [[arch-025]], [[arch-003]].
