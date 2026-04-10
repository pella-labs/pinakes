# Circuit Breaker Pattern

## Problem

When a downstream service is failing, continuing to send requests wastes resources and can cascade failures through the system.

## How It Works

The **circuit breaker** tracks failures. When failures exceed a threshold, it "opens" and short-circuits requests immediately without calling the downstream service.

### States

1. **Closed** — requests flow normally. Failures are counted.
2. **Open** — requests fail immediately. A timer runs.
3. **Half-Open** — after the timer, a few probe requests are allowed. If they succeed, close the circuit. If they fail, reopen.

## Configuration

```yaml
circuit_breaker:
  failure_threshold: 5          # open after 5 failures
  success_threshold: 3          # close after 3 successes in half-open
  timeout_seconds: 30           # time in open state before probing
  monitor_window_seconds: 60    # rolling window for failure count
```

## Libraries

- **resilience4j** (Java)
- **Polly** (.NET)
- **opossum** (Node.js)
- **Istio** (infrastructure-level)

## Fallback Strategies

When the circuit is open, don't just return errors. Consider:
- Returning cached data
- Returning a degraded response
- Queuing the request for retry

See [[arch-011]], [[arch-015]], [[monitoring-prometheus]].
