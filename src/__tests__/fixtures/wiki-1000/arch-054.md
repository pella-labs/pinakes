# Graceful Degradation

## Principle

When a dependency fails, provide a **degraded but functional** experience rather than a complete failure.

## Examples

- Search service down → show recently popular items
- Recommendation engine down → show generic "top sellers"
- Payment service slow → queue the order, confirm later
- Image CDN down → show placeholder images

## Implementation

```typescript
async function getRecommendations(userId: string): Promise<Product[]> {
  try {
    return await recommendationService.getPersonalized(userId);
  } catch (err) {
    logger.warn('Recommendation service unavailable, falling back', { err });
    return await productService.getTopSellers(10);
  }
}
```

## Circuit Breaker + Fallback

Combine with a circuit breaker: when the circuit opens, immediately return the fallback without waiting for a timeout.

## Communicating Degradation

Let users know the experience is degraded: "Personalized recommendations are temporarily unavailable."

See [[arch-014]], [[arch-028]], [[monitoring-prometheus]].
