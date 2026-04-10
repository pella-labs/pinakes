# Mediator Pattern and MediatR

## Concept

A **mediator** centralizes communication between objects. Instead of objects calling each other directly, they go through the mediator.

## In Application Architecture

The mediator pattern powers the "send a request, get a response" style used by MediatR (.NET) and similar libraries.

```typescript
interface Request<TResponse> {
  _brand: TResponse;  // phantom type for type safety
}

interface RequestHandler<TRequest extends Request<TResponse>, TResponse> {
  handle(request: TRequest): Promise<TResponse>;
}

class Mediator {
  private handlers = new Map<string, RequestHandler<any, any>>();

  register<T extends Request<R>, R>(requestType: string, handler: RequestHandler<T, R>) {
    this.handlers.set(requestType, handler);
  }

  async send<R>(request: Request<R>): Promise<R> {
    const handler = this.handlers.get(request.constructor.name);
    if (!handler) throw new Error(`No handler for ${request.constructor.name}`);
    return handler.handle(request);
  }
}
```

## Benefits

- Decouples sender from receiver
- Easy to add cross-cutting concerns (logging, validation) via pipeline behaviors
- Clean separation of command/query handling

See [[arch-004]], [[arch-043]].
