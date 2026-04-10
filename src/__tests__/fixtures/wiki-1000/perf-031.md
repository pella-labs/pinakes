# Circuit Breaker Pattern

## Preventing Cascade Failures

When a downstream service is failing, continuing to send requests makes things worse. A **circuit breaker** stops calling the failing service, giving it time to recover.

## States

- **Closed**: requests flow normally. Failures are counted.
- **Open**: requests are immediately rejected without calling the downstream. A timer starts.
- **Half-Open**: after the timer expires, a limited number of probe requests are allowed. If they succeed, the circuit closes. If they fail, it reopens.

## Configuration

```typescript
interface CircuitBreakerConfig {
  failureThreshold: number;      // failures before opening (e.g., 5)
  successThreshold: number;      // successes in half-open to close (e.g., 3)
  timeout: number;               // ms before transitioning to half-open (e.g., 30000)
  monitorInterval: number;       // sliding window for failure counting (e.g., 60000)
}
```

## Fallback Strategies

When the circuit is open, provide a degraded experience rather than an error:

- Return cached data (stale but available)
- Return a default value
- Route to an alternative service
- Show a graceful degradation UI

## Monitoring

Track circuit state transitions in your metrics. A circuit that opens frequently indicates a systemic reliability problem with the downstream service.

See [[perf-029]] for load balancing and [[perf-032]] for bulkhead patterns.
