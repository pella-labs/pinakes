# Real User Monitoring (RUM)

## Beyond Synthetic Monitoring

**Synthetic monitoring** tells you if the system works. **Real User Monitoring** tells you how real users actually experience it. RUM captures metrics from actual browser sessions.

## Core Web Vitals

Google's user experience metrics:

- **LCP** (Largest Contentful Paint): loading performance. Target: <2.5s
- **INP** (Interaction to Next Paint): interactivity. Target: <200ms
- **CLS** (Cumulative Layout Shift): visual stability. Target: <0.1

## Collecting RUM Data

```typescript
// Using the web-vitals library
import { onLCP, onINP, onCLS } from 'web-vitals';

function sendMetric(metric: { name: string; value: number }) {
  navigator.sendBeacon('/analytics', JSON.stringify(metric));
}

onLCP(sendMetric);
onINP(sendMetric);
onCLS(sendMetric);
```

## Segmentation

Aggregate RUM data by dimensions that affect performance:

- Geographic region
- Device type (mobile/desktop)
- Browser and version
- Connection speed (4G/3G/wifi)
- Page or route

The p75 latency in rural India on a 3G connection is a very different number than the p75 in a US data center on fiber.

## Correlation with Backend

Link RUM traces to backend distributed traces via the `traceparent` header. This gives you true end-to-end visibility from user click to database query.

See [[perf-045]] for APM and [[perf-017]] for OpenTelemetry.
