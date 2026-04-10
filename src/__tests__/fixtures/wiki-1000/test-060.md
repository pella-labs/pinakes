# Testing Webhooks

**Webhooks** deliver event notifications via HTTP POST. Testing them requires simulating incoming requests and verifying outgoing ones.

## Receiving Webhooks

```typescript
describe('Stripe webhook handler', () => {
  it('processes checkout.session.completed', async () => {
    const payload = createStripeEvent('checkout.session.completed', {
      id: 'cs_123',
      amount_total: 2999,
    });

    const signature = signWebhook(payload, webhookSecret);

    const res = await app.post('/webhooks/stripe')
      .set('stripe-signature', signature)
      .send(payload);

    expect(res.status).toBe(200);
    // Verify side effect
    const order = await orderRepo.findByCheckout('cs_123');
    expect(order.status).toBe('paid');
  });

  it('rejects invalid signature', async () => {
    const res = await app.post('/webhooks/stripe')
      .set('stripe-signature', 'invalid')
      .send({ type: 'checkout.session.completed' });

    expect(res.status).toBe(401);
  });
});
```

## Sending Webhooks

Test that your webhook dispatcher handles failures correctly:

- Retries on 5xx responses
- Backs off exponentially
- Disables webhooks after repeated failures
- Logs delivery status

## Signature Verification

Always verify webhook signatures. Test both valid and invalid signatures, and test that the verification uses the correct algorithm.
