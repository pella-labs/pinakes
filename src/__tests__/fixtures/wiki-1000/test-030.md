# Testing Middleware

**Middleware** sits between the request and the response handler. Testing it in isolation ensures it correctly transforms, validates, or rejects requests.

## Express Middleware Testing

```typescript
import { Request, Response } from 'express';

function authMiddleware(req: Request, res: Response, next: Function) {
  const token = req.headers.authorization;
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

describe('authMiddleware', () => {
  it('calls next with valid token', () => {
    const req = { headers: { authorization: 'Bearer abc123' } } as Request;
    const res = {} as Response;
    const next = vi.fn();

    authMiddleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('returns 401 without token', () => {
    const req = { headers: {} } as Request;
    const json = vi.fn();
    const res = { status: vi.fn().mockReturnValue({ json }) } as unknown as Response;
    const next = vi.fn();

    authMiddleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});
```

## Middleware Composition

Test middleware in combination, not just individually. The order of middleware matters, and bugs often appear at the boundaries between them.

## Request/Response Mocking

Use libraries like **node-mocks-http** for more realistic request and response objects rather than building them by hand.
