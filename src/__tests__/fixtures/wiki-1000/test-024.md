# Test Organization Patterns

How you organize tests affects maintainability as the codebase grows. A thoughtful structure scales better than a haphazard one.

## Co-located Tests

Place test files next to the code they test:

```
src/
  user/
    user.service.ts
    user.service.test.ts
    user.repository.ts
    user.repository.test.ts
```

Benefits: easy to find tests, easy to see untested code, moves with the code during refactoring.

## Dedicated Test Directory

```
src/
  user/
    user.service.ts
tests/
  user/
    user.service.test.ts
```

Benefits: cleaner source directory, easier to exclude from builds.

## Hybrid Approach

Co-locate unit tests. Put integration and e2e tests in a dedicated directory:

```
src/
  user/
    user.service.ts
    __tests__/
      user.service.test.ts
tests/
  integration/
    user-flow.test.ts
  e2e/
    checkout.test.ts
```

## Naming Conventions

- `*.test.ts` for unit tests
- `*.integration.test.ts` for integration tests
- `*.e2e.test.ts` for end-to-end tests

This allows selective running:

```bash
vitest --include "**/*.test.ts" --exclude "**/*.integration.*"
```

See [[test-019]] for how organization affects CI pipeline design.
