# Testing Tree Structures

Trees are fundamental data structures. Testing them requires covering traversal, mutation, and edge cases.

## Traversal Orders

```typescript
const tree = {
  value: 1,
  children: [
    { value: 2, children: [{ value: 4, children: [] }] },
    { value: 3, children: [{ value: 5, children: [] }] },
  ],
};

it('traverses depth-first pre-order', () => {
  expect(dfs(tree, 'pre')).toEqual([1, 2, 4, 3, 5]);
});

it('traverses depth-first post-order', () => {
  expect(dfs(tree, 'post')).toEqual([4, 2, 5, 3, 1]);
});

it('traverses breadth-first', () => {
  expect(bfs(tree)).toEqual([1, 2, 3, 4, 5]);
});
```

## Tree Mutations

```typescript
it('inserts node at correct position', () => {
  const bst = BinarySearchTree.from([5, 3, 7]);
  bst.insert(4);
  expect(bst.inOrder()).toEqual([3, 4, 5, 7]);
});

it('deletes node and rebalances', () => {
  const bst = BinarySearchTree.from([5, 3, 7, 2, 4]);
  bst.delete(3);
  expect(bst.inOrder()).toEqual([2, 4, 5, 7]);
});
```

## Edge Cases

- Empty tree
- Single-node tree
- Tree with only left children (linear)
- Tree with only right children (linear)
- Balanced vs heavily unbalanced

## Tree Equality

Test deep equality comparison that handles structural differences in representation.
