---
title: Testing Third-Party Integrations
tags: [testing, integrations, api]
created: 2025-10-10
---

# Testing Third-Party Integrations

Third-party APIs are outside your control. Test your integration code robustly to handle their variability.

## Recording and Replaying

Use **nock** or **MSW** to record real API responses and replay them in tests:

```typescript
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

const server = setupServer(
  http.get('https://api.stripe.com/v1/charges/:id', () => {
    return HttpResponse.json({
      id: 'ch_123',
      amount: 2000,
      status: 'succeeded',
    });
  })
);

beforeAll(() => server.listen());
afterAll(() => server.close());

it('fetches charge details', async () => {
  const charge = await stripeClient.getCharge('ch_123');
  expect(charge.amount).toBe(2000);
});
```

## Error Response Handling

Test how your code handles various error responses:

- 400 Bad Request
- 401 Unauthorized (expired API key)
- 429 Too Many Requests
- 500 Internal Server Error
- Network timeout
- Malformed response body

## Contract Verification

Periodically run tests against the real API in a staging environment to verify your recorded responses are still accurate.

## Timeout and Retry

Test that your client handles slow responses gracefully. Configure timeouts and verify retry behavior.
