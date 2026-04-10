import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseMarkdown, type SectionNode } from '../../ingest/parse/markdown.js';
import { chunkSection } from '../../ingest/parse/chunk.js';

/**
 * Parse + chunker tests for KG-MCP Phase 2.
 *
 * Two tests:
 *   1. Chunker is deterministic on the auth.md fixture (parse twice → identical)
 *   2. File → nodes → chunks → recombine preserves non-whitespace content
 *
 * Both run against `src/__tests__/fixtures/wiki/auth.md` so they exercise
 * the same content the spike tests (and Phase 4 hybrid retrieval tests) use.
 */

const __dirname = resolve(fileURLToPath(import.meta.url), '..');
const FIXTURE_DIR = resolve(__dirname, '../fixtures/wiki');

function loadFixture(name: string): string {
  return readFileSync(resolve(FIXTURE_DIR, name), 'utf8');
}

describe('ingest/parse (Phase 2)', () => {
  it('parser + chunker is deterministic on auth.md', () => {
    const source = loadFixture('auth.md');

    // First pass
    const sections1 = parseMarkdown(source);
    const chunks1 = sections1.flatMap((s) => chunkSection(s.content));

    // Second pass
    const sections2 = parseMarkdown(source);
    const chunks2 = sections2.flatMap((s) => chunkSection(s.content));

    // Sections must be deeply equal across runs (same input → same output).
    expect(sections1).toEqual(sections2);
    expect(chunks1).toEqual(chunks2);

    // Sanity: auth.md has 1 H1 + 3 H2 = 4 sections.
    expect(sections1.length).toBe(4);
    expect(sections1[0]!.title).toBe('Authentication');
    expect(sections1[0]!.depth).toBe(1);
    expect(sections1[0]!.section_path).toBe('Authentication');
    expect(sections1[1]!.title).toBe('Login flow');
    expect(sections1[1]!.depth).toBe(2);
    expect(sections1[1]!.section_path).toBe('Authentication / Login flow');
    expect(sections1[2]!.section_path).toBe('Authentication / Password reset');
    expect(sections1[3]!.section_path).toBe('Authentication / Session revocation');
  });

  it('file → nodes → chunks → recombine preserves non-whitespace content', () => {
    const source = loadFixture('auth.md');
    const sections = parseMarkdown(source);

    // Round-trip 1: joining all section contents should yield text whose
    // non-whitespace characters match the original. Sections may have
    // overlapping whitespace (the chunker doesn't preserve every \n
    // perfectly), so we compare on the stripped form.
    const sectionsJoined = sections.map((s) => s.content).join('');
    expect(stripWhitespace(sectionsJoined)).toBe(stripWhitespace(source));

    // Round-trip 2: chunking each section and joining the chunks should
    // also preserve the non-whitespace content of the original. Chunks
    // are joined within a section by `\n\n` (the chunker's delimiter)
    // and sections are joined by nothing — the round-trip is approximate
    // on whitespace but exact on content characters.
    const chunksJoined = sections
      .map((s) =>
        chunkSection(s.content)
          .map((c) => c.text)
          .join('\n\n')
      )
      .join('\n\n');
    expect(stripWhitespace(chunksJoined)).toBe(stripWhitespace(source));

    // Every section produces at least one chunk (even single-heading sections
    // produce a chunk containing just the heading text).
    for (const s of sections) {
      const chunks = chunkSection(s.content);
      expect(chunks.length).toBeGreaterThanOrEqual(1);
      for (const c of chunks) {
        expect(c.text.length).toBeGreaterThan(0);
        expect(c.token_count).toBeGreaterThan(0);
      }
    }
  });
});

/**
 * Strip every whitespace character so we can compare two strings for content
 * equality regardless of how the parser preserved (or normalized) blank lines.
 */
function stripWhitespace(s: string): string {
  return s.replace(/\s+/g, '');
}

// Type-only sanity: SectionNode shape stays stable.
type _CheckSectionNode = SectionNode['section_path'] extends string ? true : false;
const _typeCheck: _CheckSectionNode = true;
void _typeCheck;
