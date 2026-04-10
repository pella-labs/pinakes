# Feature Flags

## Purpose

**Feature flags** (toggles) decouple deployment from release. Ship code to production behind a flag, enable it for specific users, then roll out gradually.

## Types

| Type | Lifetime | Example |
|---|---|---|
| Release toggle | Days to weeks | New checkout flow |
| Experiment toggle | Weeks | A/B test pricing |
| Ops toggle | Permanent | Kill switch for expensive feature |
| Permission toggle | Permanent | Premium feature access |

## Implementation

Keep it simple:

```typescript
interface FeatureFlags {
  isEnabled(flag: string, context?: FlagContext): boolean;
}

// Simple in-memory for dev
class StaticFlags implements FeatureFlags {
  private flags = new Map<string, boolean>();
  isEnabled(flag: string): boolean {
    return this.flags.get(flag) ?? false;
  }
}
```

## Hygiene

- Clean up release toggles within 2 sprints of full rollout
- Track technical debt from long-lived flags
- Test both flag states in CI

See [[arch-020]], [[perf-caching]].
