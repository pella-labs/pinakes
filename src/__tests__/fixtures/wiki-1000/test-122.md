---
title: Testing Documentation
tags: [testing, docs, automation]
---

# Testing Documentation

Documentation that's wrong is worse than no documentation. Automated tests catch documentation drift.

## Code Example Testing

Extract code examples from documentation and execute them:

```typescript
import { extractCodeBlocks } from './doc-parser';

const blocks = extractCodeBlocks('docs/getting-started.md');

blocks.forEach((block, i) => {
  it(`example ${i + 1} compiles`, () => {
    const diagnostics = compileTsString(block.code);
    expect(diagnostics).toHaveLength(0);
  });
});
```

## Link Checking

```typescript
it('has no broken links', async () => {
  const links = extractLinks('docs/**/*.md');
  const results = await Promise.all(
    links.map(async (link) => ({
      url: link,
      status: await checkLink(link),
    }))
  );

  const broken = results.filter(r => r.status !== 200);
  expect(broken).toHaveLength(0);
});
```

## API Documentation Accuracy

Compare API documentation against the actual API schema:

```typescript
it('documents all endpoints', () => {
  const documented = getDocumentedEndpoints();
  const actual = getRegisteredRoutes(app);

  actual.forEach(route => {
    expect(documented).toContainEqual(
      expect.objectContaining({ method: route.method, path: route.path })
    );
  });
});
```

## README Testing

Test that the README's quick-start instructions actually work by running them in a fresh environment.

## Changelog Verification

Test that the changelog is updated for each release. Compare the latest tag to the changelog's latest entry.
