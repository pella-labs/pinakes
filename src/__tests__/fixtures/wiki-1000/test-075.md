
# Testing Polymorphic Behavior

When different types share an interface, test each implementation against the shared contract.

## Interface Compliance Tests

Create a shared test suite that all implementations must pass:

```typescript
function shapeTests(createShape: () => Shape) {
  it('has positive area', () => {
    const shape = createShape();
    expect(shape.area()).toBeGreaterThan(0);
  });

  it('has non-negative perimeter', () => {
    const shape = createShape();
    expect(shape.perimeter()).toBeGreaterThanOrEqual(0);
  });

  it('contains its center point', () => {
    const shape = createShape();
    const center = shape.center();
    expect(shape.contains(center)).toBe(true);
  });
}

describe('Circle', () => shapeTests(() => new Circle(5)));
describe('Rectangle', () => shapeTests(() => new Rectangle(3, 4)));
describe('Triangle', () => shapeTests(() => new Triangle(3, 4, 5)));
```

## Liskov Substitution Testing

If B extends A, every test that passes for A should also pass for B. Shared test suites enforce this automatically.

## Strategy Pattern Testing

When behavior varies by strategy, test each strategy independently and test that the context correctly delegates to the active strategy.

## Type-Specific Behavior

After testing shared behavior, add tests for type-specific features. A Circle has radius-specific methods that Rectangle doesn't.
