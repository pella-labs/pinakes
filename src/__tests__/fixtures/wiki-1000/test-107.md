
# Testing State Management

Global state management (Redux, Zustand, Jotai) needs isolated tests that verify state transitions without UI coupling.

## Reducer Testing

```typescript
describe('cartReducer', () => {
  it('adds item to empty cart', () => {
    const state = cartReducer(initialState, {
      type: 'ADD_ITEM',
      payload: { id: '1', name: 'Widget', price: 9.99 },
    });

    expect(state.items).toHaveLength(1);
    expect(state.total).toBe(9.99);
  });

  it('increments quantity for existing item', () => {
    const stateWithItem = {
      items: [{ id: '1', name: 'Widget', price: 9.99, quantity: 1 }],
      total: 9.99,
    };

    const state = cartReducer(stateWithItem, {
      type: 'ADD_ITEM',
      payload: { id: '1', name: 'Widget', price: 9.99 },
    });

    expect(state.items).toHaveLength(1);
    expect(state.items[0].quantity).toBe(2);
    expect(state.total).toBe(19.98);
  });
});
```

## Selector Testing

```typescript
it('selects filtered items', () => {
  const state = {
    items: [
      { id: '1', category: 'electronics' },
      { id: '2', category: 'books' },
      { id: '3', category: 'electronics' },
    ],
    filter: 'electronics',
  };

  expect(selectFilteredItems(state)).toHaveLength(2);
});
```

## Side Effect Testing

For Redux Thunks or Sagas, test the async flow:

```typescript
it('fetches and stores users', async () => {
  const store = createTestStore();
  await store.dispatch(fetchUsers());

  expect(store.getState().users.data).toHaveLength(3);
  expect(store.getState().users.loading).toBe(false);
});
```
