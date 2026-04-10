# Feature Flags and Toggles

**Feature flags** decouple deployment from release. Code ships to production behind a flag and is activated independently. This enables trunk-based development, canary releases, and A/B testing.

## Types of Toggles

- **Release toggles**: hide incomplete features. Short-lived (days to weeks). Remove after full rollout.
- **Experiment toggles**: A/B tests. Medium-lived (weeks). Owned by product/growth.
- **Ops toggles**: kill switches and degraded-mode switches. Long-lived. Owned by SRE.
- **Permission toggles**: per-user or per-tenant feature access. Long-lived. Owned by product.

## Implementation

Keep the flag evaluation path fast and simple. Avoid deeply nested flag checks — they create combinatorial complexity.

```typescript
// Simple feature flag service
interface FeatureFlagService {
  isEnabled(flag: string, context?: FlagContext): boolean;
}

interface FlagContext {
  userId?: string;
  tenantId?: string;
  environment?: string;
  percentage?: number;
}

// Usage — guard at the entry point, not scattered through the code
async function handleCheckout(req: Request): Promise<Response> {
  if (flags.isEnabled('new-checkout-flow', { userId: req.userId })) {
    return newCheckoutHandler(req);
  }
  return legacyCheckoutHandler(req);
}
```

## Flag Hygiene

Tech debt from stale flags accumulates fast. Enforce:

- Every flag has an **owner** and a **removal date**
- CI warns on flags older than their removal date
- Quarterly flag cleanup sprints

## Providers

Self-hosted: Unleash, Flagsmith. SaaS: LaunchDarkly, Split, Statsig. For simple cases, a config file or environment variable is sufficient (see [[arch-021]]).

Feature flags interact with [[deploy-pipeline]] for progressive rollouts and with [[monitoring-setup]] for experiment metrics.
