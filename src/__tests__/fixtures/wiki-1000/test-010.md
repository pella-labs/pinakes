# Visual Regression Testing

**Visual regression testing** catches unintended UI changes by comparing screenshots of the application before and after code changes.

## How It Works

1. Capture baseline screenshots of UI components or pages
2. After code changes, capture new screenshots
3. Pixel-diff the two sets
4. Flag any differences for human review

## Tools

- **Chromatic** — cloud-hosted visual testing for Storybook
- **Percy** — works with any web framework
- **Playwright** — built-in screenshot comparison
- **BackstopJS** — open source, config-driven

```typescript
test('homepage matches snapshot', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveScreenshot('homepage.png', {
    maxDiffPixelRatio: 0.01,
  });
});
```

## Challenges

Visual regression tests are inherently flaky. Font rendering differences across operating systems, animation timing, and dynamic content all cause false positives. Teams need a strategy for handling acceptable differences.

## Component-Level vs Page-Level

Testing individual components in **Storybook** is more stable than testing full pages. Components have fewer moving parts and render consistently. Page-level visual tests should be reserved for critical layouts only.
