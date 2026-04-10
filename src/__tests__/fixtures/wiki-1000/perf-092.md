# Edge Computing Performance

## What Edge Computing Offers

**Edge computing** runs application logic at CDN edge locations, close to users. Benefits:

- Sub-10ms network latency to users
- Dynamic content generation without origin round-trip
- Personalization at the edge
- Request filtering and transformation

## Edge Worker Patterns

### Compute at Edge
Run business logic in edge workers (Cloudflare Workers, Vercel Edge Functions). Best for lightweight transformations, A/B testing, and personalization.

### Edge + Origin Hybrid
Use the edge for caching, auth, and request routing. Fall through to the origin for complex queries.

### Edge KV Stores
Store configuration, feature flags, and user preferences in edge-replicated key-value stores for sub-millisecond reads.

## Constraints

Edge environments have limitations:
- Limited CPU time per request (typically 50ms)
- Limited memory
- No persistent connections to databases
- Subset of APIs (no file system, limited networking)

## When to Use Edge

Edge computing is valuable when:
- Users are globally distributed
- Responses can be computed from cached data
- Latency is a competitive advantage
- You need to filter/transform requests before they reach the origin

See [[perf-005]] for CDN caching.
