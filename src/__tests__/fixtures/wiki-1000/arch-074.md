# Webhook Design

## Concept

**Webhooks** are HTTP callbacks. When an event happens in your system, you POST a notification to a URL the subscriber configured.

## Design Checklist

- **Retry with backoff** — if delivery fails, retry with exponential backoff
- **Signature verification** — sign payloads with HMAC-SHA256 so subscribers can verify authenticity
- **Idempotency** — include an event ID; subscribers should deduplicate
- **Timeout** — 5-10 second timeout per delivery attempt
- **Payload** — include enough context to be useful, but send a slim payload with a URL to fetch full details

## Payload Format

```json
{
  "id": "evt_abc123",
  "type": "order.completed",
  "created_at": "2024-06-15T10:30:00Z",
  "data": {
    "order_id": "ord_xyz",
    "total_cents": 4999
  },
  "api_version": "2024-06-01"
}
```

## Security

```typescript
function verifyWebhookSignature(payload: string, signature: string, secret: string): boolean {
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}
```

See [[api-rest-design]], [[arch-003]].
