# Unit Testing Fundamentals

Unit testing forms the backbone of any reliable software system. A **unit test** isolates a single function or method and verifies its behavior against known inputs and expected outputs.

## Why Unit Tests Matter

The primary value of unit tests is fast feedback. When a developer changes a function, the relevant unit tests should run in milliseconds and immediately flag regressions. This tight feedback loop is what makes **test-driven development** practical.

Without unit tests, developers rely on manual testing or integration tests that take minutes to run. Both approaches slow down iteration and increase the cost of finding bugs.

## Anatomy of a Good Unit Test

A well-structured unit test follows the **AAA pattern**: Arrange, Act, Assert.

```typescript
describe('calculateDiscount', () => {
  it('applies 10% discount for orders over $100', () => {
    // Arrange
    const order = { total: 150, items: 3 };

    // Act
    const result = calculateDiscount(order);

    // Assert
    expect(result).toBe(135);
  });
});
```

Each test should verify one behavior. If a test name contains "and", it probably tests too much.

## Common Pitfalls

- Testing implementation details instead of behavior
- Excessive mocking that makes tests brittle
- Not testing edge cases (null, empty, boundary values)
- Writing tests that depend on execution order

See also [[test-002]] for integration testing and [[test-005]] for mocking strategies.

## Test Isolation

Every unit test must be independent. Shared state between tests leads to order-dependent failures that are extremely difficult to debug. In practice this means each test creates its own data, runs its operation, and verifies the result without relying on any side effect from another test.

The most common violation is shared mutable variables at the module level. A counter that increments across tests, a cache that fills up, or a mock that records calls from previous tests can all cause intermittent failures that only appear when tests run in a specific order.

Vitest and Jest both support random test ordering to surface these issues early. Enable it and run your suite multiple times to verify true isolation.

## Test Naming

A good test name describes the scenario and expected outcome. When a test fails, the name should tell you what went wrong without reading the test body. Some teams use the pattern "should [expected behavior] when [scenario]" which reads naturally in test output.
