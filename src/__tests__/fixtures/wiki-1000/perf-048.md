# Lazy Loading and Code Splitting

## Why Split

A single JavaScript bundle forces users to download and parse code for pages they haven't visited. **Code splitting** breaks the bundle into chunks loaded on demand.

## Route-Based Splitting

The most natural split point is at route boundaries:

```typescript
// React lazy loading
const Dashboard = React.lazy(() => import('./pages/Dashboard'));
const Settings = React.lazy(() => import('./pages/Settings'));

function App() {
  return (
    <Suspense fallback={<Spinner />}>
      <Routes>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
    </Suspense>
  );
}
```

## Component-Level Splitting

Split heavy components that aren't visible on initial render: modals, charts, rich text editors.

## Image Lazy Loading

```html
<img src="photo.jpg" loading="lazy" alt="Descriptive text">
```

The browser defers loading until the image is near the viewport.

## Measuring Impact

Track bundle size per route in CI. Alert when a route's JavaScript exceeds a budget (e.g., 200KB gzipped).

See [[perf-047]] for browser caching.
