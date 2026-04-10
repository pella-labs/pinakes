import { fromMarkdown } from 'mdast-util-from-markdown';

// Minimal local types for the subset of mdast we touch. Avoids depending on
// `@types/mdast` and `mdast-util-to-string` which are transitive deps of
// `mdast-util-from-markdown` and not directly resolvable under strict pnpm.
interface MdastPosition {
  start: { offset?: number };
  end: { offset?: number };
}
interface MdastNode {
  type: string;
  value?: string;
  depth?: number;
  position?: MdastPosition;
  children?: MdastNode[];
}

/**
 * Markdown → section parser for KG-MCP Phase 2.
 *
 * Parses a markdown file into a flat array of `SectionNode` objects, one
 * per ATX heading (`#`, `##`, …) plus an optional pre-heading section for
 * any content above the first heading. The chunker (chunk.ts) then splits
 * each section's `content` into ~500-token chunks.
 *
 * **Why mdast?** Phase 1 used a `\n\n` regex split that lost all heading
 * structure. The Karpathy two-level wiki has nested H1/H2/H3 sections, and
 * the LLM querying via `kg.search` benefits from being able to identify
 * "this chunk lives under H2 'Login flow' which lives under H1 'Authentication'".
 * The `section_path` field captures that hierarchy.
 *
 * **Section content slicing**: we use mdast `position.start.offset` to slice
 * the original source for each section, so the stored content includes the
 * exact original markdown (whitespace, formatting, code fences) — not a
 * re-rendered approximation. This makes round-trip tests trivial: rebuild a
 * file by joining all section contents and you should get back something
 * structurally identical to the input.
 *
 * **Determinism**: same input → same output. Pinned `mdast-util-from-markdown@^2.0.0`
 * + no plugins = stable mdast tree, stable section list, stable downstream
 * chunk ids. Tests verify this by parsing twice and deep-equal-ing the result.
 */

/**
 * One section of a markdown file. Sections are derived from ATX headings;
 * a `SectionNode { depth: 0 }` is the optional pre-heading content above
 * the first heading.
 */
export interface SectionNode {
  /** ATX heading hierarchy joined by ` / ` (e.g. `"Authentication / Login flow"`); empty for pre-heading content */
  section_path: string;
  /** The heading text itself (or empty string for pre-heading content) */
  title: string;
  /** Original markdown source for this section (heading + body), preserving whitespace */
  content: string;
  /** Always `'section'` for Phase 2 — Phase 4 may add other kinds (entity, decision) */
  kind: 'section';
  /** ATX depth: 0 = pre-heading, 1 = `#`, 2 = `##`, …, 6 = `######` */
  depth: number;
}

/** Confidence level for provenance tracking (Phase 6). */
export type Confidence = 'extracted' | 'inferred' | 'ambiguous';

/**
 * Detect confidence from YAML frontmatter in a markdown file.
 *
 * Rules:
 * - `source: haiku` or `source: ai` or `source: ai-generated` → `'inferred'`
 * - `status: ambiguous` or `status: needs-review` or `confidence: ambiguous` → `'ambiguous'`
 * - `confidence: inferred` → `'inferred'`
 * - Otherwise → `'extracted'`
 */
export function detectConfidence(source: string): Confidence {
  const fm = parseFrontmatter(source);
  if (!fm) return 'extracted';

  // Check explicit confidence field first
  if (fm.confidence === 'inferred') return 'inferred';
  if (fm.confidence === 'ambiguous') return 'ambiguous';

  // Check source field
  const src = typeof fm.source === 'string' ? fm.source.toLowerCase() : '';
  if (src === 'haiku' || src === 'ai' || src === 'ai-generated') return 'inferred';

  // Check status field
  const status = typeof fm.status === 'string' ? fm.status.toLowerCase() : '';
  if (status === 'ambiguous' || status === 'needs-review') return 'ambiguous';

  return 'extracted';
}

/**
 * Minimal YAML frontmatter parser. Extracts key: value pairs from
 * `---\n...\n---` blocks at the start of a file. No dependency needed.
 */
function parseFrontmatter(source: string): Record<string, string> | null {
  if (!source.startsWith('---')) return null;
  const endIdx = source.indexOf('\n---', 3);
  if (endIdx === -1) return null;

  const block = source.slice(4, endIdx);
  const result: Record<string, string> = {};
  for (const line of block.split('\n')) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    const val = line.slice(colon + 1).trim();
    if (key) result[key] = val;
  }
  return result;
}

/**
 * Parse a markdown source string into a flat list of sections.
 *
 * Sections are emitted in source order (top-to-bottom). Empty pre-heading
 * content (whitespace only) is skipped. Sections with no body (just a
 * heading and nothing after) are still emitted — the chunker handles them
 * by producing zero chunks for that section.
 */
export function parseMarkdown(source: string): SectionNode[] {
  const tree = fromMarkdown(source) as unknown as MdastNode;
  const sections: SectionNode[] = [];
  const rootChildren = tree.children ?? [];

  // Pass 1: collect every top-level heading with its source offset.
  // We only care about headings at the root of the mdast tree — nested
  // headings inside blockquotes or lists are unusual and we treat them
  // as part of the surrounding section's body.
  const headings: Array<{
    depth: number;
    title: string;
    startOffset: number;
  }> = [];

  for (const child of rootChildren) {
    if (child.type !== 'heading') continue;
    const start = child.position?.start.offset;
    if (typeof start !== 'number') continue; // defensive: should always be present
    headings.push({
      depth: child.depth ?? 1,
      title: mdastNodeText(child).trim(),
      startOffset: start,
    });
  }

  // Edge case: no headings at all → one big pre-heading section (if non-empty).
  if (headings.length === 0) {
    if (source.trim().length > 0) {
      sections.push({
        section_path: '',
        title: '',
        content: source,
        kind: 'section',
        depth: 0,
      });
    }
    return sections;
  }

  // Pre-heading content: anything before the first heading.
  const firstStart = headings[0]!.startOffset;
  if (firstStart > 0) {
    const preContent = source.slice(0, firstStart);
    if (preContent.trim().length > 0) {
      sections.push({
        section_path: '',
        title: '',
        content: preContent,
        kind: 'section',
        depth: 0,
      });
    }
  }

  // Pass 2: walk the heading list, building section_path via a depth stack
  // and slicing content from this heading's offset to the next heading's
  // offset (or EOF for the final section).
  const stack: Array<{ depth: number; title: string }> = [];

  for (let i = 0; i < headings.length; i++) {
    const h = headings[i]!;

    // Pop the stack until the top is a strict ancestor of `h`.
    // This handles unusual cases like H1 → H3 → H2 (the H2 pops the H3
    // but keeps the H1 ancestor).
    while (stack.length > 0 && stack[stack.length - 1]!.depth >= h.depth) {
      stack.pop();
    }
    stack.push({ depth: h.depth, title: h.title });

    const sectionPath = stack.map((s) => s.title).join(' / ');

    const startOffset = h.startOffset;
    const endOffset = i + 1 < headings.length ? headings[i + 1]!.startOffset : source.length;
    const content = source.slice(startOffset, endOffset);

    sections.push({
      section_path: sectionPath,
      title: h.title,
      content,
      kind: 'section',
      depth: h.depth,
    });
  }

  return sections;
}

/**
 * Recursively concatenate the text content of an mdast node, ignoring
 * formatting. Equivalent to mdast-util-to-string but inlined to avoid the
 * transitive-dep import issue.
 */
function mdastNodeText(node: MdastNode): string {
  if (typeof node.value === 'string') return node.value;
  if (!node.children) return '';
  let out = '';
  for (const child of node.children) {
    out += mdastNodeText(child);
  }
  return out;
}
