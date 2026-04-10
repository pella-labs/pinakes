# Test-Driven Development

**TDD** is a development methodology where tests are written before the production code. The cycle is red-green-refactor.

## The TDD Cycle

1. **Red**: Write a failing test that defines desired behavior
2. **Green**: Write the minimum code to make the test pass
3. **Refactor**: Clean up the code while keeping tests green

This cycle typically takes 1-5 minutes per iteration. Longer cycles suggest the steps are too large.

## Benefits

TDD naturally produces code with high test coverage, but coverage is a side effect, not the goal. The real benefits are:

- Forces you to think about the API before implementation
- Produces small, focused functions
- Creates a safety net for refactoring
- Documents expected behavior

## When TDD Doesn't Fit

TDD works poorly for exploratory coding, UI prototyping, and performance optimization. It also struggles with highly concurrent or event-driven code where behavior depends on timing.

## Classic vs London School

The **classic school** (Detroit) tests behavior through the public interface. The **London school** (mockist) isolates each unit with mocks. Most teams blend both approaches depending on context.

## TDD in Practice

Real-world TDD requires discipline. The temptation to write more production code than the test demands is constant. The key insight is that each test should drive exactly one small behavior change. If you find yourself writing 50 lines of production code to make a test pass, the test was too ambitious.

Start with the simplest case. For a calculator, the first test might be "returns 0 when adding 0 and 0". Then "returns 5 when adding 2 and 3". Then "handles negative numbers". Each test adds one dimension of complexity.

The refactor step is where TDD pays dividends. Because you have comprehensive tests, you can restructure code confidently. Rename variables, extract methods, change data structures, all while the tests verify that behavior is preserved. Without TDD, refactoring is a gamble. With TDD, it's routine maintenance.

Teams that adopt TDD often report that their debugging time drops dramatically. When every behavior is covered by a test, bugs are caught within minutes of introduction rather than days or weeks later in production. The investment in writing tests first is recovered many times over in reduced debugging time.
