# Testing Audit Trails

**Audit trails** record who did what and when. They're essential for compliance and debugging.

## Recording Actions

```typescript
it('records user action in audit log', async () => {
  await updateUser(1, { name: 'New Name' }, { actor: 'admin@test.com' });

  const audit = await getAuditLog({ entityType: 'user', entityId: '1' });
  expect(audit[0]).toMatchObject({
    action: 'update',
    actor: 'admin@test.com',
    changes: { name: { from: 'Old Name', to: 'New Name' } },
  });
});
```

## Completeness

Every state-changing operation should produce an audit entry. Test by performing all CRUD operations and verifying each has a corresponding audit record.

## Immutability

Audit records must not be modifiable:

```typescript
it('prevents modification of audit records', async () => {
  await expect(
    db.update('audit_log', { action: 'delete' }, { id: auditId })
  ).rejects.toThrow();
});
```

## Timestamp Accuracy

Test that audit timestamps are within a reasonable range of the actual operation time and are stored in UTC.

## Sensitive Data Handling

Audit records should log that a change occurred without recording sensitive values. Test that passwords, tokens, and PII are not stored in the audit trail.

See [[test-072]] for privacy compliance testing.
