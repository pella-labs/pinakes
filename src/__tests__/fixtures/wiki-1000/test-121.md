# Testing Cross-Browser Compatibility

Different browsers render and execute code differently. Cross-browser testing catches browser-specific bugs.

## Browser Matrix

Define which browsers and versions your application supports:

- Chrome (latest 2 versions)
- Firefox (latest 2 versions)
- Safari (latest 2 versions)
- Edge (latest 2 versions)
- Mobile Safari (iOS 15+)
- Chrome for Android

## Playwright Multi-Browser

```typescript
import { test, expect } from '@playwright/test';

// This runs in Chromium, Firefox, and WebKit
test('renders correctly', async ({ page, browserName }) => {
  await page.goto('/');
  const title = await page.textContent('h1');
  expect(title).toBe('Welcome');

  // Browser-specific assertion
  if (browserName === 'webkit') {
    // Safari-specific behavior
  }
});
```

## CSS Rendering Differences

Visual regression tests across browsers catch rendering differences. Use Playwright's built-in screenshot comparison with per-browser baselines.

## API Polyfills

Test that polyfills are loaded for browsers that need them and skipped for browsers that don't. Unnecessary polyfills increase bundle size.

## Touch vs Mouse Events

Mobile browsers use touch events instead of mouse events. Test that interactive elements work with both input methods.

See [[test-003]] for end-to-end testing and [[test-010]] for visual regression.
