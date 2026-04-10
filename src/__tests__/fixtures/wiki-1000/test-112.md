# Testing Middleware Chains

Middleware chains process requests through a series of handlers. Testing ensures correct ordering, short-circuiting, and error propagation.

## Order of Execution

```typescript
it('executes middleware in order', async () => {
  const order: string[] = [];

  const mw1 = async (ctx: Context, next: Next) => {
    order.push('mw1-before');
    await next();
    order.push('mw1-after');
  };

  const mw2 = async (ctx: Context, next: Next) => {
    order.push('mw2-before');
    await next();
    order.push('mw2-after');
  };

  await executeChain([mw1, mw2], createContext());
  expect(order).toEqual(['mw1-before', 'mw2-before', 'mw2-after', 'mw1-after']);
});
```

## Short-Circuiting

```typescript
it('short-circuits when middleware does not call next', async () => {
  const auth = async (ctx: Context, next: Next) => {
    if (!ctx.token) {
      ctx.status = 401;
      return; // don't call next
    }
    await next();
  };

  const handler = vi.fn();
  await executeChain([auth, handler], { token: null });

  expect(handler).not.toHaveBeenCalled();
});
```

## Error Propagation

Test that errors in downstream middleware are caught by upstream error handlers:

```typescript
it('catches downstream errors', async () => {
  const errorHandler = vi.fn(async (ctx, next) => {
    try { await next(); } catch (e) { ctx.error = e.message; }
  });

  const failing = async () => { throw new Error('boom'); };

  const ctx = createContext();
  await executeChain([errorHandler, failing], ctx);
  expect(ctx.error).toBe('boom');
});
```

See [[test-030]] for testing individual middleware and [[test-074]] for routing.
