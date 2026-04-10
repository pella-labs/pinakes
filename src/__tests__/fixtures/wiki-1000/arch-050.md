# Chain of Responsibility

## Pattern

Pass a request along a chain of handlers. Each handler decides to process the request or pass it to the next handler.

## Middleware Example

Express/Koa/Hono middleware is chain of responsibility:

```typescript
type Middleware = (req: Request, res: Response, next: () => void) => void;

const logging: Middleware = (req, res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
};

const auth: Middleware = (req, res, next) => {
  if (!req.headers.authorization) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
};

const rateLimiting: Middleware = (req, res, next) => {
  if (isRateLimited(req)) {
    res.status(429).json({ error: 'Too many requests' });
    return;
  }
  next();
};

app.use(logging, auth, rateLimiting);
```

## Benefits

- Each handler has a single responsibility
- Easy to add/remove/reorder handlers
- Handlers don't know about each other

See [[arch-030]], [[arch-034]].
