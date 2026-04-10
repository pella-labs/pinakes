# Mutation Testing

**Mutation testing** evaluates the quality of your test suite by introducing small changes (mutations) to the source code and checking whether tests catch them.

## How It Works

A mutation testing tool:

1. Parses your source code
2. Creates **mutants** by applying operators (e.g., changing `>` to `>=`, removing a line, swapping `true` for `false`)
3. Runs the test suite against each mutant
4. Reports the **mutation score**: percentage of mutants killed by tests

## Mutation Operators

Common mutations include:

- Arithmetic: `+` to `-`, `*` to `/`
- Conditional: `>` to `>=`, `==` to `!=`
- Logical: `&&` to `||`, `!` removal
- Statement: deleting lines, return value changes
- Boundary: off-by-one modifications

## Stryker Mutator

**Stryker** is the standard mutation testing framework for JavaScript/TypeScript:

```bash
npx stryker run
```

It integrates with vitest, jest, and mocha. Results show which mutants survived, pointing to weak spots in your test coverage.

## Limitations

Mutation testing is computationally expensive. Running it on a large codebase can take hours. Most teams run it on critical modules only or during scheduled CI jobs rather than on every commit.

## Mutation Score vs Coverage

A codebase can have 100% line coverage but a 60% mutation score. Coverage tells you what code ran; mutation testing tells you whether your assertions actually verify behavior. See [[test-016]] for more on test coverage metrics.
