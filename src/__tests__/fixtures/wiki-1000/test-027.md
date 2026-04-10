---
title: Testing React Components
tags: [testing, react, frontend]
created: 2025-09-14
---

# Testing React Components

Component testing verifies that UI components render correctly and respond to user interactions. The **React Testing Library** philosophy: test what users see, not implementation details.

## Rendering Tests

```typescript
import { render, screen } from '@testing-library/react';

it('renders user name', () => {
  render(<UserCard user={{ name: 'Alice', role: 'admin' }} />);
  expect(screen.getByText('Alice')).toBeInTheDocument();
  expect(screen.getByText('admin')).toBeInTheDocument();
});
```

## Interaction Tests

```typescript
it('submits form with entered data', async () => {
  const onSubmit = vi.fn();
  render(<ContactForm onSubmit={onSubmit} />);

  await userEvent.type(screen.getByLabelText('Email'), 'test@example.com');
  await userEvent.click(screen.getByRole('button', { name: 'Send' }));

  expect(onSubmit).toHaveBeenCalledWith({ email: 'test@example.com' });
});
```

## Querying Elements

Prefer accessible queries in this order:
1. `getByRole` — most accessible
2. `getByLabelText` — form elements
3. `getByText` — visible text
4. `getByTestId` — last resort

## Avoiding Implementation Tests

Don't test state variables, internal methods, or component instances. Test what the user would see and interact with. If refactoring changes implementation but not behavior, tests should still pass.

See [[test-010]] for visual regression and [[test-021]] for accessibility testing of components.
