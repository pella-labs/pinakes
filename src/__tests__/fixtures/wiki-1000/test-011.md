---
title: Snapshot Testing
tags: [testing, snapshots, jest]
created: 2025-10-20
---

# Snapshot Testing

**Snapshot testing** records the output of a function or component and compares it against a stored reference. Any change in output triggers a test failure.

## Use Cases

Snapshots work well for:

- React component rendering
- API response shapes
- Serialized data structures
- Configuration file generation
- CLI output validation

## The Problem with Snapshots

Snapshots are easy to create but hard to maintain. Developers often update snapshots without reviewing the diff, defeating the purpose entirely.

```typescript
it('renders user profile', () => {
  const tree = renderer.create(<UserProfile user={mockUser} />).toJSON();
  expect(tree).toMatchSnapshot();
});
```

When this test fails, the developer runs `vitest -u` to update the snapshot. If they don't carefully review the diff, a bug can slip through disguised as an intentional change.

## Inline Snapshots

Inline snapshots embed the expected output directly in the test file, making diffs more visible in code review:

```typescript
expect(formatDate('2025-01-15')).toMatchInlineSnapshot('"January 15, 2025"');
```

## Guidelines

- Use snapshots for large, stable outputs
- Prefer inline snapshots for small values
- Review snapshot diffs in PRs as carefully as code changes
- Don't snapshot volatile data (timestamps, random IDs)

See [[test-010]] for visual regression as an alternative approach.
