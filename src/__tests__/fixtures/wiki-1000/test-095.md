# Testing Permission Systems

Permission systems control who can do what. Testing them requires exhaustive coverage of allow and deny scenarios.

## Role-Based Access

```typescript
describe('permissions', () => {
  const roles = ['admin', 'editor', 'viewer'] as const;
  const actions = ['create', 'read', 'update', 'delete'] as const;

  const matrix: Record<string, Record<string, boolean>> = {
    admin:  { create: true,  read: true,  update: true,  delete: true },
    editor: { create: true,  read: true,  update: true,  delete: false },
    viewer: { create: false, read: true,  update: false, delete: false },
  };

  roles.forEach(role => {
    actions.forEach(action => {
      const expected = matrix[role][action];
      it(`${role} ${expected ? 'can' : 'cannot'} ${action}`, () => {
        expect(hasPermission(role, action)).toBe(expected);
      });
    });
  });
});
```

## Resource Ownership

Users should only access their own resources unless they have elevated permissions:

```typescript
it('user cannot read other users private data', async () => {
  const res = await api.get('/users/2/private', {
    headers: { Authorization: user1Token },
  });
  expect(res.status).toBe(403);
});
```

## Permission Escalation

Test that users cannot escalate their own permissions:

```typescript
it('non-admin cannot promote to admin', async () => {
  const res = await api.put('/users/1/role', { role: 'admin' }, {
    headers: { Authorization: editorToken },
  });
  expect(res.status).toBe(403);
});
```

## Inherited Permissions

If permissions cascade (team -> project -> file), test that inheritance works correctly and that overrides at lower levels take precedence.
