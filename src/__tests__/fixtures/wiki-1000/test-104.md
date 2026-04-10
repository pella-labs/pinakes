# Testing Form Validation

Form validation has both client-side and server-side components. Both must be tested.

## Client-Side Validation

```typescript
it('shows error for empty required field', async () => {
  render(<RegistrationForm />);

  await userEvent.click(screen.getByRole('button', { name: 'Submit' }));

  expect(screen.getByText('Email is required')).toBeInTheDocument();
});

it('validates email format', async () => {
  render(<RegistrationForm />);

  await userEvent.type(screen.getByLabelText('Email'), 'not-an-email');
  await userEvent.tab(); // trigger blur validation

  expect(screen.getByText('Invalid email format')).toBeInTheDocument();
});
```

## Server-Side Validation

Never trust client-side validation alone. Test server-side validation independently:

```typescript
it('rejects invalid data server-side', async () => {
  const res = await api.post('/register', {
    email: 'not-an-email',
    password: '123', // too short
  });
  expect(res.status).toBe(422);
  expect(res.body.errors).toContainEqual({ field: 'email', message: 'Invalid email' });
  expect(res.body.errors).toContainEqual({ field: 'password', message: 'Min 8 characters' });
});
```

## Cross-Field Validation

Test validations that depend on multiple fields:

```typescript
it('requires password confirmation to match', async () => {
  const res = await api.post('/register', {
    email: 'test@test.com',
    password: 'secure123',
    passwordConfirmation: 'different',
  });
  expect(res.status).toBe(422);
  expect(res.body.errors[0].message).toContain('must match');
});
```
