
# Testing Notification Systems

Notifications are user-facing and time-sensitive. Testing them ensures delivery, content accuracy, and preference respect.

## Delivery Testing

```typescript
it('sends push notification for new message', async () => {
  const notifications = new TestNotificationService();
  const handler = new MessageHandler(notifications);

  await handler.onNewMessage({
    from: 'Alice',
    to: 'Bob',
    content: 'Hello!',
  });

  expect(notifications.sent).toHaveLength(1);
  expect(notifications.sent[0].recipient).toBe('Bob');
  expect(notifications.sent[0].title).toBe('New message from Alice');
});
```

## Preference Respect

```typescript
it('does not send when user opted out', async () => {
  await setPreference('Bob', 'push_notifications', false);

  await handler.onNewMessage({
    from: 'Alice',
    to: 'Bob',
    content: 'Hello!',
  });

  expect(notifications.sent).toHaveLength(0);
});
```

## Deduplication

Test that the same event doesn't trigger multiple notifications. If a user receives 10 messages in quick succession, they should get one summary notification, not 10 individual ones.

## Timing

Test notification scheduling. A "daily digest" should arrive at the configured time, not immediately.

## Multi-Channel

If notifications go to email, push, and in-app, test that channel selection follows user preferences and message priority.
