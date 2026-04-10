# Browser Caching Strategy

## Cache Layers

A browser request passes through multiple cache layers:

1. **Memory cache**: fastest, cleared on tab close
2. **Service Worker cache**: programmable, persistent
3. **HTTP cache** (disk cache): honors Cache-Control headers
4. **CDN/proxy cache**: shared, honors s-maxage

## Asset Fingerprinting

Include a content hash in asset filenames:

```
app.a1b2c3d4.js
styles.e5f6g7h8.css
```

This enables aggressive caching (`max-age=31536000, immutable`) because the URL changes when content changes.

## Service Worker Caching Strategies

- **Cache First**: check cache, fall back to network. Good for static assets.
- **Network First**: try network, fall back to cache. Good for API responses.
- **Stale While Revalidate**: serve from cache, update in background. Good for semi-dynamic content.
- **Cache Only**: never hit the network. Good for app shell.
- **Network Only**: never cache. Good for real-time data.

## Preloading and Prefetching

```html
<!-- Preload: high priority, needed for current page -->
<link rel="preload" href="/fonts/inter.woff2" as="font" crossorigin>

<!-- Prefetch: low priority, needed for next navigation -->
<link rel="prefetch" href="/next-page.js">
```

See [[perf-005]] for CDN caching and [[perf-006]] for HTTP headers.
