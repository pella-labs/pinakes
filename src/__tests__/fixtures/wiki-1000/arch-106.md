---
source: ai-generated
confidence: ambiguous
---
# Architecture Fitness Functions

## Concept

An **architecture fitness function** is an automated check that verifies the system conforms to architectural decisions.

## Examples

### Dependency Direction
```typescript
// Using ts-arch or similar
describe('Architecture', () => {
  it('domain does not depend on infrastructure', () => {
    expect(files().inFolder('domain'))
      .not.toHaveImportsFrom(folder('infrastructure'));
  });
});
```

### Response Time
```typescript
it('API p99 latency < 200ms', async () => {
  const latencies = await measureLatencies(100);
  const p99 = percentile(latencies, 99);
  expect(p99).toBeLessThan(200);
});
```

### Schema Size
```typescript
it('MCP tool schema < 1500 tokens', () => {
  const schema = generateToolSchema();
  const tokens = countTokens(JSON.stringify(schema));
  expect(tokens).toBeLessThan(1500);
});
```

## Continuous Architecture

Run fitness functions in CI. Failing fitness functions block the merge, just like failing tests.

See [[testing-integration]], [[arch-064]].
