# Pipes and Filters Architecture

## Concept

Data flows through a pipeline of independent **filters**, connected by **pipes**. Each filter transforms the data and passes it to the next.

## Unix Philosophy

```bash
cat access.log | grep "POST" | awk '{print $7}' | sort | uniq -c | sort -rn | head -20
```

This is pipes and filters. Each command is a filter. stdin/stdout are pipes.

## In Application Architecture

```typescript
type Filter<T> = (input: T) => T;

function pipeline<T>(...filters: Filter<T>[]): Filter<T> {
  return (input: T) => filters.reduce((data, filter) => filter(data), input);
}

const processOrder = pipeline(
  validateOrder,
  calculateTax,
  applyDiscount,
  assignWarehouse,
);

const result = processOrder(rawOrder);
```

## Benefits

- Filters are independently testable
- Easy to add, remove, or reorder steps
- Each filter has a single responsibility

## When to Use

Data transformation pipelines, ETL, request processing, compiler phases.

See [[arch-050]], [[arch-030]].
