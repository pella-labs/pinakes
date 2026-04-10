# End-to-End Testing

End-to-end tests validate the entire system from the user's perspective. They exercise the full stack: UI, API, database, and any external services.

## The Cost-Benefit Tradeoff

E2E tests provide the highest confidence but at the highest cost. They are slow, flaky, and expensive to maintain. A single e2e test might take 30 seconds to run and break when any layer changes.

The rule of thumb: write e2e tests for critical user journeys only.

## Choosing a Framework

For web applications, **Playwright** has become the standard choice over Cypress for most teams. It supports multiple browsers, runs tests in parallel, and handles modern web patterns well.

```typescript
test('user can complete checkout', async ({ page }) => {
  await page.goto('/products');
  await page.click('[data-testid="add-to-cart"]');
  await page.click('[data-testid="checkout"]');
  await page.fill('#email', 'buyer@test.com');
  await page.click('[data-testid="place-order"]');
  await expect(page.locator('.confirmation')).toBeVisible();
});
```

## Managing Test Data

E2E tests need consistent starting states. Common approaches include:

- Database seeding before each test run
- API-driven setup using admin endpoints
- Snapshot restoration from known-good states
- Factory patterns that create test data programmatically

The setup phase often takes longer than the test itself. Invest in making it fast and reliable.

## Dealing with Flakiness

Flaky e2e tests erode trust in the entire test suite. See [[test-014]] for strategies on detecting and eliminating flaky tests.
