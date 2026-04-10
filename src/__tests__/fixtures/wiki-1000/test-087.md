# Testing Backward Compatibility

**Backward compatibility** ensures that updates don't break existing users. Testing it requires maintaining a set of legacy scenarios.

## API Response Compatibility

Save snapshots of API responses from previous versions and verify they're still valid:

```typescript
const legacyResponses = loadFixtures('api/v1/responses/*.json');

legacyResponses.forEach(({ name, response }) => {
  it(`still accepts legacy response: ${name}`, () => {
    expect(() => parseResponse(response)).not.toThrow();
  });
});
```

## Database Schema Compatibility

Test that code can read data written by previous versions:

```typescript
it('reads v1 format data', async () => {
  await db.exec(v1MigrationScript);
  await db.exec(v1SeedData);
  await db.exec(currentMigrationScript);

  const result = await currentCodeQuery();
  expect(result).toBeDefined();
});
```

## Configuration Compatibility

Old configuration files should still work with new code. Test with configuration samples from previous releases.

## Protocol Compatibility

For networked services, test that old clients can still communicate with new servers. This is especially important for gRPC and binary protocols.

## Breaking Change Detection

Automate detection of breaking changes using tools like **api-extractor** or **publint** for package APIs. See [[test-022]] for API contract testing.
