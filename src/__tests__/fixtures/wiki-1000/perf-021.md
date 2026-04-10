# Error Budget Policies

## What Happens When the Budget Burns

An **error budget policy** defines organizational responses when reliability degrades. Without one, error budgets are just numbers on a dashboard.

## Policy Tiers

### Green (>50% budget remaining)
Normal operations. Ship features freely. Run experiments.

### Yellow (25-50% budget remaining)
Increase review rigor. No risky deployments without rollback plans. Prioritize reliability-related tech debt.

### Red (<25% budget remaining)
Feature freeze. All engineering effort shifts to reliability. Only ship bug fixes and reliability improvements. Post-mortem any incident that consumed >5% of budget.

### Budget Exhausted
Full stop on non-critical changes until budget regenerates. Executive review of reliability roadmap.

## Earning Trust Back

After a budget exhaustion event, teams must demonstrate sustained reliability before resuming feature work. A common pattern is requiring 7 consecutive days within SLO before lifting restrictions.

## Cross-Team Dependencies

When service A depends on service B, and B's unreliability consumes A's error budget, escalate to B's team. Error budgets create accountability across service boundaries.

See [[perf-020]] for SLO fundamentals.
