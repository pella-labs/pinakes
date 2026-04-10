---
title: Testing GraphQL Subscriptions
tags: [testing, graphql, websocket]
---

# Testing GraphQL Subscriptions

GraphQL subscriptions deliver real-time updates. Testing them combines WebSocket testing with GraphQL schema verification.

## Subscription Setup

```typescript
it('receives updates for new messages', async () => {
  const client = createTestClient();

  const subscription = client.subscribe(`
    subscription {
      messageAdded(channelId: "general") {
        id
        text
        author
      }
    }
  `);

  const messages: any[] = [];
  subscription.on('data', (msg) => messages.push(msg));

  // Trigger the event
  await createMessage({ channelId: 'general', text: 'Hello', author: 'Alice' });

  await waitFor(() => messages.length > 0);
  expect(messages[0].messageAdded.text).toBe('Hello');
});
```

## Filtering

Test that subscriptions only receive events matching their filter criteria:

```typescript
it('only receives messages for subscribed channel', async () => {
  const sub = subscribe('messageAdded', { channelId: 'general' });

  await createMessage({ channelId: 'random', text: 'Wrong channel' });
  await createMessage({ channelId: 'general', text: 'Right channel' });

  await sleep(100);
  expect(sub.received).toHaveLength(1);
  expect(sub.received[0].text).toBe('Right channel');
});
```

## Connection Recovery

Test that subscriptions are re-established after connection drops. See [[test-036]] for WebSocket connection testing.
