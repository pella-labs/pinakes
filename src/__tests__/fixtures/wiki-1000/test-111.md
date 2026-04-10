# Testing Memory Allocation Patterns

Understanding memory allocation helps prevent performance issues in hot paths.

## Object Pool Testing

```typescript
it('reuses pooled objects', () => {
  const pool = new ObjectPool(() => new Buffer(1024), 5);

  const obj1 = pool.acquire();
  pool.release(obj1);
  const obj2 = pool.acquire();

  expect(obj2).toBe(obj1); // same object reused
});

it('creates new object when pool is empty', () => {
  const pool = new ObjectPool(() => new Buffer(1024), 1);

  const obj1 = pool.acquire();
  const obj2 = pool.acquire(); // pool empty, creates new

  expect(obj2).not.toBe(obj1);
});
```

## Arena Allocation

Test that arena-allocated objects are all freed when the arena is released:

```typescript
it('frees all allocations on arena reset', () => {
  const arena = new Arena(1024);
  arena.alloc(100);
  arena.alloc(200);
  arena.alloc(300);

  expect(arena.used).toBe(600);
  arena.reset();
  expect(arena.used).toBe(0);
});
```

## String Interning

Test that string interning reduces memory usage for repeated strings:

```typescript
it('interns identical strings', () => {
  const pool = new StringPool();
  const s1 = pool.intern('hello');
  const s2 = pool.intern('hello');
  expect(s1).toBe(s2);
});
```

See [[test-049]] for detecting memory leaks at the application level.
