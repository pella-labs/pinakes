# Throttling Pattern

## Approaches

### Client-Side Throttling
The client limits its own request rate. Useful for respecting API quotas.

### Server-Side Throttling
The server rejects requests that exceed a threshold.

### Adaptive Throttling
Dynamically adjust limits based on system load.

## Server Response

When throttled, return HTTP 429 with headers:

```
HTTP/1.1 429 Too Many Requests
Retry-After: 30
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1718451234
```

## Priority-Based Throttling

Not all traffic is equal. Assign priorities:
- **Critical** — payment webhooks (never throttle)
- **High** — authenticated API calls
- **Medium** — search queries
- **Low** — analytics, background sync

Throttle low-priority traffic first.

See [[arch-034]], [[arch-014]], [[arch-028]].
