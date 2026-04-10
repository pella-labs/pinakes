# Testing Command Pattern

The **command pattern** encapsulates operations as objects. Testing it verifies execution, undo, and command history.

## Command Execution

```typescript
describe('AddItemCommand', () => {
  it('adds item to inventory', () => {
    const inventory = new Inventory();
    const cmd = new AddItemCommand(inventory, { id: '1', name: 'Widget' });

    cmd.execute();

    expect(inventory.items).toHaveLength(1);
    expect(inventory.items[0].name).toBe('Widget');
  });

  it('undoes item addition', () => {
    const inventory = new Inventory();
    const cmd = new AddItemCommand(inventory, { id: '1', name: 'Widget' });

    cmd.execute();
    cmd.undo();

    expect(inventory.items).toHaveLength(0);
  });
});
```

## Command Queue

```typescript
it('executes commands in order', async () => {
  const queue = new CommandQueue();
  const results: number[] = [];

  queue.enqueue(new LambdaCommand(() => results.push(1)));
  queue.enqueue(new LambdaCommand(() => results.push(2)));
  queue.enqueue(new LambdaCommand(() => results.push(3)));

  await queue.executeAll();
  expect(results).toEqual([1, 2, 3]);
});
```

## Composite Commands

Test that composite commands (macros) execute all sub-commands and undo them in reverse order.

See [[test-073]] for undo/redo testing patterns.
