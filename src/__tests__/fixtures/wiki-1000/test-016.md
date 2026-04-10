# Test Coverage Metrics

**Test coverage** measures how much of your codebase is exercised by tests. It's a useful indicator but a poor target.

## Types of Coverage

- **Line coverage**: Percentage of lines executed
- **Branch coverage**: Percentage of conditional branches taken
- **Function coverage**: Percentage of functions called
- **Statement coverage**: Percentage of statements executed

## The Coverage Trap

Goodhart's Law applies: when coverage becomes a target, it ceases to be a good measure. Developers write trivial tests to hit coverage thresholds without actually testing behavior.

```typescript
// This "test" achieves 100% coverage but tests nothing
it('calls the function', () => {
  processOrder({ id: 1, items: [] });
  // no assertions!
});
```

## Recommended Approach

- Set a **floor** (e.g., 70%) to prevent coverage from dropping
- Don't mandate 100% — it incentivizes bad tests
- Focus on **branch coverage** over line coverage
- Use coverage reports to find untested code, not to prove quality
- Combine with [[test-012]] mutation testing for meaningful quality metrics

## Coverage in CI

```yaml
# vitest.config.ts
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      thresholds: {
        branches: 70,
        functions: 75,
        lines: 80,
      },
    },
  },
});
```

Coverage reports in CI should block merges only when coverage drops below the floor, not when it fails to reach a target.
