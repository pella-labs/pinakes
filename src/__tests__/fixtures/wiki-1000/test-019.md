---
title: CI Test Pipelines
tags: [ci, testing, automation]
created: 2025-12-01
---

# CI Test Pipelines

A well-designed **CI test pipeline** balances speed with thoroughness. The goal is to catch bugs as early and as fast as possible.

## Pipeline Stages

### Stage 1: Lint + Type Check (< 30 seconds)
```yaml
lint:
  runs-on: ubuntu-latest
  steps:
    - run: pnpm run lint
    - run: pnpm run typecheck
```

### Stage 2: Unit Tests (< 2 minutes)
Fast, isolated, no external dependencies.

### Stage 3: Integration Tests (< 5 minutes)
Require database, may require service containers.

### Stage 4: E2E Tests (< 15 minutes)
Full stack, browser-based, run in parallel.

### Stage 5: Performance + Visual Regression (optional, nightly)

## Parallelization

Split tests across multiple CI runners. Most frameworks support sharding:

```bash
# Run shard 1 of 4
vitest --shard 1/4
```

## Caching

Cache `node_modules`, build artifacts, and test databases between runs. This alone can cut pipeline time by 50%.

## Fail-Fast Strategy

If Stage 1 fails, don't run Stage 2. If unit tests fail, don't waste compute on e2e tests. Use CI pipeline dependencies to enforce this ordering.

See [[test-014]] for handling flaky tests in CI and [[test-016]] for coverage reporting.
