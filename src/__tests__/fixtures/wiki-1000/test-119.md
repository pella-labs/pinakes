---
title: Testing Configuration Hot Reload
tags: [testing, config, runtime]
created: 2025-09-25
---

# Testing Configuration Hot Reload

Some applications reload configuration without restarting. Testing this ensures changes take effect correctly.

## Config Change Detection

```typescript
it('detects config file changes', async () => {
  const config = new HotConfig('./config.yaml');
  const changes: string[] = [];
  config.on('change', (key) => changes.push(key));

  await writeFile('./config.yaml', 'port: 8080');
  await waitFor(() => changes.length > 0);

  expect(changes).toContain('port');
  expect(config.get('port')).toBe(8080);
});
```

## Atomic Updates

Test that config changes are applied atomically. If a config file has multiple fields, all fields should update together, not one at a time.

## Invalid Config Handling

```typescript
it('keeps old config when new config is invalid', async () => {
  const config = new HotConfig('./config.yaml');
  expect(config.get('port')).toBe(3000);

  await writeFile('./config.yaml', 'invalid: yaml: [broken');

  // Should keep old value
  await sleep(500);
  expect(config.get('port')).toBe(3000);
});
```

## Subscriber Notification

Test that all config subscribers are notified of changes and receive the new values.

## Race Conditions

Test rapid consecutive changes. Only the final state should be applied, not intermediate states.

See [[test-034]] for static configuration testing.
