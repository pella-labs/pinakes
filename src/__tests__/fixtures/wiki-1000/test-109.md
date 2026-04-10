# Testing Dependency Resolution

Dependency resolution algorithms (package managers, DI containers, build systems) must handle complex constraint graphs.

## Simple Resolution

```typescript
it('resolves direct dependency', () => {
  const graph = { A: ['B'], B: [] };
  const order = resolve(graph);
  expect(order.indexOf('B')).toBeLessThan(order.indexOf('A'));
});
```

## Circular Dependency Detection

```typescript
it('detects circular dependencies', () => {
  const graph = { A: ['B'], B: ['C'], C: ['A'] };
  expect(() => resolve(graph)).toThrow('Circular dependency: A -> B -> C -> A');
});
```

## Diamond Dependencies

```typescript
it('resolves diamond dependencies', () => {
  // A depends on B and C, both depend on D
  const graph = { A: ['B', 'C'], B: ['D'], C: ['D'], D: [] };
  const order = resolve(graph);

  expect(order).toContain('D');
  expect(order.filter(x => x === 'D')).toHaveLength(1); // D appears only once
  expect(order.indexOf('D')).toBeLessThan(order.indexOf('B'));
  expect(order.indexOf('D')).toBeLessThan(order.indexOf('C'));
});
```

## Version Constraints

```typescript
it('resolves compatible versions', () => {
  const deps = {
    A: { B: '^1.0.0', C: '^2.0.0' },
    B: { D: '>=1.5.0' },
    C: { D: '^1.3.0' },
  };

  const resolved = resolveVersions(deps);
  expect(resolved.D).toBe('1.5.0'); // satisfies both constraints
});
```

## Unresolvable Constraints

Test that conflicting version requirements produce a clear error message.
