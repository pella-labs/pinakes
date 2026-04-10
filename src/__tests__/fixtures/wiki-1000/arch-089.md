# CDN Architecture

## How CDNs Work

A **Content Delivery Network** caches content at edge locations close to users, reducing latency and origin load.

## Caching Layers

```
User → [Edge POP] → [Regional Cache] → [Origin Shield] → [Origin Server]
```

Each layer reduces the load on the next.

## Cache Control Headers

```
Cache-Control: public, max-age=3600, s-maxage=86400, stale-while-revalidate=60
```

- `max-age` — browser cache duration
- `s-maxage` — CDN cache duration (overrides max-age for shared caches)
- `stale-while-revalidate` — serve stale while fetching fresh in background

## Purging

When content changes, purge the CDN cache:
- **Purge by URL** — delete a specific resource
- **Purge by tag** — delete all resources with a cache tag
- **Purge all** — nuclear option, use sparingly

## Dynamic Content at the Edge

Edge computing (Cloudflare Workers, Lambda@Edge) runs code at CDN edge locations. Good for personalization, A/B testing, auth checks.

See [[perf-caching]], [[arch-065]].
