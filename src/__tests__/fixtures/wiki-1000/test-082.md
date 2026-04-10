# Testing Markdown Parsing

Markdown parsers must handle the full CommonMark spec plus extensions. Testing ensures correct rendering.

## Basic Formatting

```typescript
describe('markdown parser', () => {
  it('parses headings', () => {
    const ast = parse('# Hello World');
    expect(ast.children[0].type).toBe('heading');
    expect(ast.children[0].depth).toBe(1);
  });

  it('parses bold and italic', () => {
    const ast = parse('**bold** and *italic*');
    const children = ast.children[0].children;
    expect(children[0].type).toBe('strong');
    expect(children[2].type).toBe('emphasis');
  });
});
```

## Code Blocks

```typescript
it('parses fenced code blocks with language', () => {
  const md = '```typescript\nconst x = 1;\n```';
  const ast = parse(md);
  const codeBlock = ast.children[0];
  expect(codeBlock.type).toBe('code');
  expect(codeBlock.lang).toBe('typescript');
  expect(codeBlock.value).toBe('const x = 1;');
});
```

## Edge Cases

- Empty document
- Only whitespace
- Deeply nested lists
- Mixed heading levels
- Raw HTML in markdown
- Very long lines
- Unicode content including emoji

## Wikilinks and Extensions

If your parser supports non-standard extensions like **wikilinks** `[[page-name]]`, test those separately from standard Markdown.

See [[test-045]] for testing search indexing of parsed markdown content.

## Building a Markdown Test Corpus

When testing a markdown parser, build a comprehensive test corpus that covers the full CommonMark specification. The CommonMark spec itself provides over 600 test cases, but real-world markdown has patterns the spec doesn't cover.

Your corpus should include:

- **Standard formatting**: headings, bold, italic, strikethrough, links, images
- **Code**: inline code, fenced blocks with language tags, indented code blocks
- **Lists**: ordered, unordered, nested, with mixed content
- **Block elements**: blockquotes, horizontal rules, tables (GFM extension)
- **Edge cases**: empty documents, deeply nested structures, extremely long lines, mixed UTF-8 encodings
- **Extension syntax**: task lists, footnotes, wikilinks, YAML frontmatter, math blocks

Each test case should include the input markdown and the expected AST or HTML output. Store them as fixture files rather than inline strings so they're easy to review and update.

When your parser fails on real-world content, add that content to the corpus. Over time the corpus becomes a regression safety net that catches parser bugs before they affect users. The effort of maintaining the corpus is repaid every time a parser change is verified against hundreds of real-world documents in seconds.
