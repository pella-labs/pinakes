# Capacity Planning

## Forecasting Demand

**Capacity planning** predicts future resource needs based on historical trends and anticipated growth. Without it, you discover capacity limits during peak traffic — the worst possible time.

## Load Testing as Baseline

Before planning, establish current capacity through load testing:

- Determine the maximum throughput at acceptable latency
- Identify the bottleneck resource (CPU, memory, I/O, network)
- Map throughput to infrastructure units (pods, instances)

## Growth Modeling

Plot historical metrics (requests/sec, storage, compute) and fit a growth curve. Common models:

- **Linear**: steady growth, add N% capacity per quarter
- **Exponential**: doubling period, plan for step-function scaling
- **Seasonal**: cyclical patterns (holiday traffic, end-of-month spikes)

## Headroom

Maintain **30-50% headroom** above forecasted peak. This absorbs:

- Organic growth between planning cycles
- Traffic spikes from marketing events or viral content
- Graceful degradation during partial outages

## Cost Efficiency

Capacity planning isn't about over-provisioning. Use:

- **Auto-scaling** for elastic workloads
- **Reserved instances** for baseline capacity
- **Spot instances** for batch processing

The goal is right-sizing: enough capacity for reliability, not so much that you waste money.

See [[perf-020]] for SLOs that inform capacity targets.
