# Synthetic Monitoring

## What It Tests

**Synthetic monitoring** runs automated tests against your application from external locations at regular intervals. Unlike RUM, it tests availability and performance without depending on real user traffic.

## Test Types

### Uptime Checks
Simple HTTP requests that verify status code and response time. Run every 1-5 minutes from multiple regions.

### Multi-Step Transactions
Simulate user workflows: login, search, add to cart, checkout. Tests end-to-end functionality.

### API Contract Tests
Verify API responses match expected schemas. Catch breaking changes before users do.

## Implementation

```typescript
// Simple synthetic check
async function checkEndpoint(url: string, expectedStatus: number): Promise<CheckResult> {
  const start = Date.now();
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    return {
      url,
      status: response.status,
      latency: Date.now() - start,
      success: response.status === expectedStatus,
    };
  } catch (error) {
    return {
      url,
      status: 0,
      latency: Date.now() - start,
      success: false,
      error: error.message,
    };
  }
}
```

## Alert on Synthetic Failures

Alert when synthetic checks fail from multiple regions simultaneously. A single-region failure might be a probe issue; multi-region failure indicates a real outage.

## Coverage

Run synthetic checks for:
- Core user journeys
- Critical API endpoints
- Third-party dependency health
- DNS resolution
- Certificate expiration

See [[perf-046]] for RUM and [[perf-016]] for alerting.
