---
confidence: ambiguous
---

# Strangler Fig Migration

The **strangler fig pattern** is a strategy for incrementally replacing a legacy system. Named after the strangler fig tree that gradually envelops its host, this approach routes traffic through a facade that delegates to either the old or new system on a per-feature basis.

## How It Works

1. Deploy the new system alongside the old one
2. Place a routing layer (proxy/gateway) in front of both
3. Migrate one feature at a time to the new system
4. Update the routing layer to send traffic for that feature to the new system
5. Repeat until no traffic goes to the old system
6. Decommission the old system

## Routing Strategies

The routing layer can split traffic by:

- **URL path**: `/api/v2/orders` goes to the new system, everything else to the old
- **Feature flag**: specific users or percentages see the new implementation
- **Header-based**: internal clients use the new system first

The [[arch-007]] API gateway is a natural place to implement this routing.

## Data Migration

The hardest part is usually the data. Options:

- **Shared database**: both systems read/write the same DB. Simple but creates tight coupling.
- **Event bridge**: the old system emits events that the new system consumes to build its own data store. See [[arch-002]].
- **Dual writes**: both systems write to both databases during transition. Fragile, use only briefly.

## When to Use

The strangler fig is ideal when a big-bang rewrite is too risky. It works best when the legacy system has clear API boundaries that can be intercepted. If the legacy system is a tangled monolith with no clear interfaces, you may need to first refactor it into a modular structure ([[arch-003]]) before applying the strangler pattern.
