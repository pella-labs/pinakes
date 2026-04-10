# Testing Error Handling

Errors are part of the contract. Testing them is just as important as testing the happy path.

## Testing Thrown Exceptions

```typescript
it('throws on invalid input', () => {
  expect(() => parseConfig('')).toThrow('Config cannot be empty');
});

it('throws specific error type', () => {
  expect(() => parseConfig('')).toThrow(ConfigError);
});
```

## Testing Async Errors

```typescript
it('rejects with network error', async () => {
  await expect(fetchUser(-1)).rejects.toThrow('Not found');
});
```

## Testing Error Boundaries

React error boundaries catch rendering errors. Test them by triggering errors in child components:

```typescript
it('shows fallback on error', () => {
  const BrokenComponent = () => { throw new Error('boom'); };
  const { getByText } = render(
    <ErrorBoundary fallback={<div>Something went wrong</div>}>
      <BrokenComponent />
    </ErrorBoundary>
  );
  expect(getByText('Something went wrong')).toBeInTheDocument();
});
```

## Error Message Quality

Test that error messages are actionable. A message like "Error occurred" helps nobody. A message like "Database connection failed: ECONNREFUSED at localhost:5432" tells the user exactly what to fix.

## Graceful Degradation

Some errors shouldn't crash the system. Test that the application degrades gracefully: shows cached data, retries with backoff, or switches to a fallback service.
