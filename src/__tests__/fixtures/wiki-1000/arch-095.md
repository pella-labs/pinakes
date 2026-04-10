# Strangler Fig with Feature Flags

## Combining Patterns

Use **feature flags** to control the strangler fig migration at runtime. This gives you instant rollback without redeploying.

## Strategy

```typescript
async function processOrder(order: OrderInput): Promise<OrderResult> {
  if (featureFlags.isEnabled('use-new-order-service', { tenantId: order.tenantId })) {
    return await newOrderService.process(order);
  }
  return await legacyOrderService.process(order);
}
```

## Gradual Rollout

1. Start with the flag off for everyone
2. Enable for internal users
3. Enable for 1% of traffic (canary)
4. Gradually increase (10%, 50%, 100%)
5. Remove the flag and the legacy code path

## Comparison Mode

Run both old and new in parallel, compare results, return the old result. Log differences.

```typescript
async function compareMode(order: OrderInput): Promise<OrderResult> {
  const [oldResult, newResult] = await Promise.all([
    legacyOrderService.process(order),
    newOrderService.process(order).catch(e => ({ error: e })),
  ]);
  if (JSON.stringify(oldResult) !== JSON.stringify(newResult)) {
    logger.warn('Result mismatch', { orderId: order.id, old: oldResult, new: newResult });
  }
  return oldResult; // always return old until confident
}
```

See [[arch-020]], [[arch-032]], [[arch-059]].
