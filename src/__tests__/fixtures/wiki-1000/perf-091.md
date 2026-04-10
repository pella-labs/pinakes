# Latency Budgets

## Breaking Down the Budget

A **latency budget** allocates the total acceptable latency across all operations in a request path. If the SLO is p99 < 500ms, every component must fit within that budget.

Example breakdown for a 500ms budget:

| Component | Budget |
|---|---|
| DNS + TCP + TLS | 50ms |
| CDN/proxy processing | 20ms |
| API gateway | 10ms |
| Authentication | 30ms |
| Database query | 100ms |
| Business logic | 50ms |
| Response serialization | 20ms |
| Network return | 50ms |
| **Buffer** | **170ms** |

The buffer absorbs variance. Without it, any component exceeding its budget causes an SLO violation.

## Measuring Component Latency

Use distributed tracing to measure actual time spent in each component. Compare against the budget to identify which components are at risk.

## Budget Governance

When adding features that consume latency:
1. Measure the latency cost
2. Determine which budget it draws from
3. If it exceeds the remaining budget, optimize something else to make room

This prevents gradual latency creep where each small addition seems harmless individually but compounds to SLO violations.

See [[perf-020]] for SLOs and [[perf-034]] for timeout design.
