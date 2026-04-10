---
title: Testing Data Privacy Compliance
tags: [testing, privacy, gdpr]
---

# Testing Data Privacy Compliance

Privacy regulations like **GDPR** and **CCPA** impose technical requirements that must be tested.

## Data Deletion (Right to Erasure)

```typescript
it('deletes all user data on request', async () => {
  const userId = await createUser({ name: 'Alice', email: 'a@b.com' });
  await createOrders(userId, 5);
  await createComments(userId, 10);

  await deleteUserData(userId);

  expect(await findUser(userId)).toBeNull();
  expect(await findOrders(userId)).toHaveLength(0);
  expect(await findComments(userId)).toHaveLength(0);
});
```

## Data Export (Right to Portability)

Test that the export includes all user data in a machine-readable format:

```typescript
it('exports all user data', async () => {
  const userId = await createUserWithData();
  const export_ = await exportUserData(userId);

  expect(export_.profile).toBeDefined();
  expect(export_.orders).toBeDefined();
  expect(export_.comments).toBeDefined();
  expect(export_.activityLog).toBeDefined();
});
```

## Consent Tracking

Test that data collection respects consent settings. If a user hasn't consented to analytics, test that no analytics events are recorded.

## Data Minimization

Test that APIs don't return more data than necessary. A public profile endpoint shouldn't include the user's email address or phone number.

## Audit Trail

Every data access should be logged. Test that the audit trail captures who accessed what data and when. See [[test-035]] for logging tests.
