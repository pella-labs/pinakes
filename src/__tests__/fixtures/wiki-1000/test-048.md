# Testing Background Jobs

Background jobs process work asynchronously. Testing them requires verifying both the job creation and the job execution.

## Job Enqueue Tests

```typescript
it('enqueues email job after order', async () => {
  const queue = new InMemoryQueue();
  await createOrder(orderData, queue);

  expect(queue.jobs).toHaveLength(1);
  expect(queue.jobs[0]).toMatchObject({
    type: 'send-order-confirmation',
    data: { orderId: expect.any(String) },
  });
});
```

## Job Processing Tests

```typescript
it('processes email job', async () => {
  const emailService = createMockEmailService();
  const processor = new JobProcessor(emailService);

  await processor.handle({
    type: 'send-order-confirmation',
    data: { orderId: '123' },
  });

  expect(emailService.sent).toHaveLength(1);
});
```

## Retry Logic

Test that failed jobs are retried correctly:

```typescript
it('retries failed job 3 times', async () => {
  let attempts = 0;
  const handler = async () => {
    attempts++;
    if (attempts < 3) throw new Error('temporary failure');
  };

  await processWithRetry(handler, { maxRetries: 3 });
  expect(attempts).toBe(3);
});
```

## Dead Letter Queue

Test that permanently failed jobs end up in the dead letter queue with sufficient context for debugging.
