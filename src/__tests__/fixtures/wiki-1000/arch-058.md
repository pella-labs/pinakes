---
source: ai-generated
confidence: ambiguous
---
# Blue/Green Deployment

## How It Works

Maintain two identical environments: **blue** (current) and **green** (new). Deploy to green, test, then switch traffic.

```
         Load Balancer
         /          \
    [Blue: v1.2]  [Green: v1.3]
     (active)      (staging)

    After switch:

         Load Balancer
         /          \
    [Blue: v1.2]  [Green: v1.3]
     (standby)     (active)
```

## Pros

- Instant rollback (switch back to blue)
- Zero-downtime deployment
- Full environment testing before switch

## Cons

- Double the infrastructure cost during deployment
- Database schema changes need careful handling
- Long-running requests may fail during switch

## Database Challenge

If v1.3 requires a schema change, you need the expand-contract pattern. Both versions must be able to work with the database during the transition.

See [[arch-024]], [[k8s-deployment]], [[arch-059]].
