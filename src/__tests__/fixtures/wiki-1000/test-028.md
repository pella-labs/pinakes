# Testing Database Migrations

Database migrations are a common source of production incidents. Testing them thoroughly prevents downtime.

## What to Test

- Forward migration applies cleanly on empty database
- Forward migration applies on database with existing data
- Rollback migration reverses changes correctly
- Data integrity is preserved after migration
- Indexes and constraints exist after migration

## Migration Test Pattern

```typescript
describe('migration 0042_add_user_preferences', () => {
  it('adds preferences table', async () => {
    await migrateUp(db, '0041');
    await seedTestData(db); // data from before migration
    await migrateUp(db, '0042');

    const tables = await db.query("SELECT name FROM sqlite_master WHERE type='table'");
    expect(tables.map(t => t.name)).toContain('user_preferences');
  });

  it('preserves existing user data', async () => {
    await migrateUp(db, '0041');
    await db.insert('users', { id: 1, name: 'Alice' });
    await migrateUp(db, '0042');

    const user = await db.query('SELECT * FROM users WHERE id = 1');
    expect(user[0].name).toBe('Alice');
  });

  it('rollback removes preferences table', async () => {
    await migrateUp(db, '0042');
    await migrateDown(db, '0042');

    const tables = await db.query("SELECT name FROM sqlite_master WHERE type='table'");
    expect(tables.map(t => t.name)).not.toContain('user_preferences');
  });
});
```

## Testing Against Production Data

Use anonymized production snapshots to verify migrations work with real data shapes, not just test fixtures. Edge cases in production data are the ones that break migrations.

See [[test-020]] for test database strategies.
