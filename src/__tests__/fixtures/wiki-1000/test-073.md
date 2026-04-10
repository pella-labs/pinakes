# Testing Undo and Redo

Undo/redo functionality requires careful state management testing to ensure operations are truly reversible.

## Basic Undo

```typescript
describe('undo/redo', () => {
  it('undoes the last action', () => {
    const editor = new TextEditor('hello');
    editor.insert(' world');
    expect(editor.text).toBe('hello world');

    editor.undo();
    expect(editor.text).toBe('hello');
  });

  it('redoes an undone action', () => {
    const editor = new TextEditor('hello');
    editor.insert(' world');
    editor.undo();
    editor.redo();
    expect(editor.text).toBe('hello world');
  });

  it('clears redo stack on new action', () => {
    const editor = new TextEditor('hello');
    editor.insert(' world');
    editor.undo();
    editor.insert(' there');
    editor.redo(); // should do nothing
    expect(editor.text).toBe('hello there');
  });
});
```

## Complex Operations

Test undo for operations that affect multiple items simultaneously, like batch updates or drag-and-drop reordering.

## Undo Limits

Test behavior when the undo history is full. The oldest actions should be dropped when the stack exceeds its limit.
