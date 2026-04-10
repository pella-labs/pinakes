# Performance Culture

## Measuring What Matters

Performance culture starts with measuring user-facing metrics, not infrastructure metrics. CPU utilization is meaningless if users are happy. Latency percentiles are meaningful because they directly reflect user experience.

## Performance Budgets

Set explicit budgets for:

- Page load time (web)
- Time to interactive (web)
- API response time per endpoint
- Bundle size (frontend)
- Memory per container

Build CI checks that fail when budgets are exceeded. Budgets prevent gradual degradation.

## Performance Reviews

Schedule periodic performance reviews where the team examines trends:

- Has p99 latency increased this quarter?
- Which endpoints regressed and why?
- Are we on track for capacity needs next quarter?

## Load Testing in CI

Run lightweight load tests on every PR that touches performance-sensitive code. Use a dedicated environment that mirrors production topology.

## Blameless Performance Retrospectives

When a performance regression reaches production, conduct a retrospective focused on:

- Why wasn't it caught in testing?
- What monitoring gap allowed it to persist?
- What process change prevents recurrence?

## Making It Sustainable

Performance work is never done. Allocate a consistent percentage of engineering time (10-20%) to performance and reliability, not just when things are on fire.

The teams that build great software treat performance as a feature, not an afterthought. Every sprint should include some performance-related work, even if it's just reviewing dashboards and updating budgets.

See [[perf-020]] for SLOs and [[perf-100]] for the observability maturity model.
