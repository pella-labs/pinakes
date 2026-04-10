---
title: Testing Feature Flags
tags: [testing, feature-flags, deployment]
created: 2025-11-20
---

# Testing Feature Flags

**Feature flags** enable gradual rollouts and quick rollbacks. Testing them ensures flags behave correctly in all states.

## Testing Both States

Every feature flag creates a branch in behavior. Test both branches:

```typescript
describe('new-checkout feature flag', () => {
  it('shows old checkout when disabled', () => {
    setFlag('new-checkout', false);
    const { getByText } = render(<CheckoutPage />);
    expect(getByText('Classic Checkout')).toBeInTheDocument();
  });

  it('shows new checkout when enabled', () => {
    setFlag('new-checkout', true);
    const { getByText } = render(<CheckoutPage />);
    expect(getByText('New Checkout Experience')).toBeInTheDocument();
  });
});
```

## Flag Cleanup

Stale feature flags accumulate technical debt. Test that your codebase has no references to flags that have been fully rolled out:

```bash
# CI check: no references to removed flags
grep -r "REMOVED_FLAG_NAME" src/ && exit 1 || exit 0
```

## Default Values

Test that flag defaults are safe. If the flag service is unreachable, the default should be the conservative option (usually the old behavior).

## Percentage Rollouts

For flags rolled out to a percentage of users, test that the bucketing is deterministic. The same user should always see the same variant.
