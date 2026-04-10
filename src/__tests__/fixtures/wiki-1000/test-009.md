# Regression Testing

**Regression testing** ensures that new changes don't break existing functionality. It's the safety net that makes continuous delivery possible.

## Types of Regression Tests

- **Full regression**: Running the entire test suite. Expensive but thorough.
- **Selective regression**: Running only tests related to changed code. Faster but riskier.
- **Risk-based regression**: Prioritizing tests for high-risk areas.

## Test Selection Strategies

Modern CI systems support intelligent test selection:

```bash
# Run only tests affected by changed files
vitest --changed HEAD~1

# Run tests matching specific patterns
vitest --grep "checkout|payment"
```

## When Regressions Slip Through

A regression that reaches production indicates a gap in the test suite. The response should be:

1. Write a test that catches the specific regression
2. Analyze why existing tests missed it
3. Add similar tests for analogous scenarios
4. Consider whether the testing strategy needs adjustment

## Automated vs Manual Regression

Manual regression testing doesn't scale. A team with 200 features can't manually verify all of them before each release. Automate the critical paths and use exploratory testing for the rest. See [[test-003]] for e2e approaches.
