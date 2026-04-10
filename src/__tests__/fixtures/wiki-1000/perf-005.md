# CDN Caching and Edge Strategy

## The Edge Advantage

A **Content Delivery Network** caches responses at edge locations close to users. This reduces origin load and latency. The key challenge is controlling what gets cached and for how long.

## Cache-Control Headers

```
Cache-Control: public, max-age=31536000, immutable
Cache-Control: private, no-cache
Cache-Control: public, s-maxage=3600, stale-while-revalidate=86400
```

The `s-maxage` directive is CDN-specific — it overrides `max-age` for shared caches while letting browsers use a different TTL.

## Stale-While-Revalidate

The **stale-while-revalidate** pattern serves stale content immediately while fetching fresh content in the background. This eliminates the latency spike on cache expiration.

- First request after expiry: served from stale cache (fast)
- Background revalidation happens asynchronously
- Next request gets fresh content
- Users never see the revalidation delay

## Cache Key Design

Poor cache key design leads to either excessive cache misses or serving wrong content. Consider:

- Vary header for content negotiation
- Query parameter normalization (sort, deduplicate)
- Device-type segmentation (mobile vs desktop)
- Geographic segmentation when content differs by region

## Purge Strategies

- **Instant purge**: API call to CDN to remove specific URLs
- **Tag-based purge**: associate content with tags, purge by tag
- **Soft purge**: mark content as stale, serve while revalidating

See [[perf-001]] for general invalidation and [[perf-047]] for HTTP caching deep dive.
