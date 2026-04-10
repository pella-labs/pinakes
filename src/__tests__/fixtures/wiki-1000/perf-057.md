# Load Testing with k6

## Why k6

**k6** is a modern load testing tool that uses JavaScript for test scripts. It's developer-friendly, scriptable, and produces detailed metrics.

## Basic Test

```typescript
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '2m', target: 100 },  // ramp up
    { duration: '5m', target: 100 },  // sustained load
    { duration: '2m', target: 0 },    // ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],  // 95% of requests under 500ms
    http_req_failed: ['rate<0.01'],    // less than 1% errors
  },
};

export default function () {
  const res = http.get('https://api.example.com/users');
  check(res, {
    'status is 200': (r) => r.status === 200,
    'response time < 500ms': (r) => r.timings.duration < 500,
  });
  sleep(1);
}
```

## Scenario Patterns

- **Constant arrival rate**: fixed RPS regardless of response time
- **Ramping VUs**: gradually increase virtual users
- **Spike testing**: sudden traffic surge
- **Soak testing**: sustained load over hours to find memory leaks

## Integration with Grafana

Export k6 metrics to Prometheus or InfluxDB and visualize in Grafana for real-time dashboards during load tests.

See [[perf-056]] for benchmarking methodology and [[perf-025]] for capacity planning.
