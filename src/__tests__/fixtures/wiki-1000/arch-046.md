# Strategy Pattern

## When to Use

When you have multiple algorithms for the same task and want to select one at runtime.

## Example: Notification Strategy

```typescript
interface NotificationStrategy {
  send(userId: string, message: string): Promise<void>;
}

class EmailNotification implements NotificationStrategy {
  async send(userId: string, message: string): Promise<void> {
    // send email
  }
}

class SmsNotification implements NotificationStrategy {
  async send(userId: string, message: string): Promise<void> {
    // send SMS
  }
}

class PushNotification implements NotificationStrategy {
  async send(userId: string, message: string): Promise<void> {
    // send push notification
  }
}

// Usage
class NotificationService {
  constructor(private strategy: NotificationStrategy) {}

  async notify(userId: string, message: string): Promise<void> {
    await this.strategy.send(userId, message);
  }
}
```

## Relation to DI

Strategy pattern is essentially dependency injection for algorithms. The consumer doesn't care which strategy it gets.

See [[arch-031]], [[arch-030]].
