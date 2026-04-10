# Load Testing

**Load testing** measures how a system behaves under expected and peak traffic conditions. It answers the question: will this survive production traffic?

## Types of Load Tests

- **Baseline**: Normal expected traffic
- **Stress**: Beyond expected limits to find the breaking point
- **Spike**: Sudden burst of traffic
- **Soak**: Sustained load over hours to find memory leaks
- **Breakpoint**: Gradually increasing load until failure

## k6 for Load Testing

```typescript
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '2m', target: 100 },  // ramp up
    { duration: '5m', target: 100 },  // steady state
    { duration: '2m', target: 0 },    // ramp down
  ],
};

export default function () {
  const res = http.get('http://localhost:3000/api/search');
  check(res, {
    'status is 200': (r) => r.status === 200,
    'response time < 500ms': (r) => r.timings.duration < 500,
  });
  sleep(1);
}
```

## Key Metrics

- **Response time** (p50, p95, p99)
- **Throughput** (requests per second)
- **Error rate**
- **Resource utilization** (CPU, memory, connections)

See [[test-018]] for chaos engineering and [[test-023]] for performance benchmarks.
