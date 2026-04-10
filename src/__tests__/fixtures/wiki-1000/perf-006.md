---
title: HTTP Caching Headers Deep Dive
tags: [http, caching, headers]
---
# HTTP Caching Headers Deep Dive

## The Full Header Taxonomy

Understanding HTTP caching requires knowing how **Cache-Control**, **ETag**, **Last-Modified**, and **Vary** interact.

### Cache-Control Directives

| Directive | Meaning |
|---|---|
| `public` | Any cache may store |
| `private` | Only browser cache |
| `no-cache` | Must revalidate before use |
| `no-store` | Never cache |
| `max-age=N` | Fresh for N seconds |
| `s-maxage=N` | CDN-specific max-age |
| `immutable` | Never revalidate |
| `stale-while-revalidate=N` | Serve stale for N seconds while revalidating |

### Conditional Requests

When a cached response expires, the browser sends a **conditional request** using `If-None-Match` (ETag) or `If-Modified-Since` (Last-Modified). The server responds with either 304 Not Modified (use cache) or 200 OK with fresh content.

```bash
# Request with conditional headers
curl -I -H "If-None-Match: \"abc123\"" https://api.example.com/data

# Response if unchanged
HTTP/2 304
ETag: "abc123"
Cache-Control: max-age=3600
```

### The Vary Header Trap

`Vary: Accept-Encoding, Authorization` tells caches to store separate copies for each combination of those request headers. Over-using Vary effectively disables caching because the combinatorial explosion of cache keys reduces hit rates to near zero.

## Recommended Patterns

- Static assets with content hash in filename: `Cache-Control: public, max-age=31536000, immutable`
- API responses: `Cache-Control: private, no-cache` with ETag
- HTML pages: `Cache-Control: public, s-maxage=60, stale-while-revalidate=300`
