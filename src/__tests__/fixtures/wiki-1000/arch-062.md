# Vertical Slice Architecture

## The Problem with Layers

In layered architecture, a single feature touches every layer. Adding "create order" means changes in the controller, service, repository, and model layers.

## Vertical Slices

Instead of organizing by technical layer, organize by **feature**. Each slice contains everything needed for one feature.

```
src/
  features/
    create-order/
      handler.ts
      validator.ts
      repository.ts
      types.ts
    cancel-order/
      handler.ts
      validator.ts
      repository.ts
      types.ts
```

## Benefits

- Low coupling between features
- Easy to understand (everything for a feature is co-located)
- Can use different patterns per slice (simple CRUD vs. full DDD)

## Trade-offs

- Code duplication between slices (sometimes acceptable)
- Cross-cutting concerns need a different approach (middleware, decorators)
- Less familiar to teams used to layered architecture

See [[arch-019]], [[arch-010]].
