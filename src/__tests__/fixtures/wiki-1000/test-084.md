# Testing Plugin Systems

Plugin systems extend functionality at runtime. Testing them requires verifying the plugin lifecycle and isolation.

## Plugin Loading

```typescript
it('loads plugin from file', async () => {
  const plugin = await loadPlugin('./plugins/my-plugin');
  expect(plugin.name).toBe('my-plugin');
  expect(plugin.version).toBe('1.0.0');
});
```

## Plugin Lifecycle

```typescript
it('calls lifecycle hooks in order', async () => {
  const calls: string[] = [];
  const plugin = {
    onInit: () => calls.push('init'),
    onStart: () => calls.push('start'),
    onStop: () => calls.push('stop'),
  };

  const system = new PluginSystem();
  system.register(plugin);
  await system.start();
  await system.stop();

  expect(calls).toEqual(['init', 'start', 'stop']);
});
```

## Plugin Isolation

Test that one plugin's failure doesn't crash the whole system:

```typescript
it('isolates plugin failures', async () => {
  const badPlugin = { onStart: () => { throw new Error('crash'); } };
  const goodPlugin = { onStart: vi.fn() };

  const system = new PluginSystem();
  system.register(badPlugin);
  system.register(goodPlugin);
  await system.start();

  expect(goodPlugin.onStart).toHaveBeenCalled();
});
```

## Plugin API Surface

Test that plugins only have access to the API they're supposed to use, not internal system state.
