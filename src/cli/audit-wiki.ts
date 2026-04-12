import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { closeDb, openDb } from '../db/client.js';
import { queryGaps, type GapRow } from '../gaps/detector.js';
import { createLlmProvider, type LlmProvider } from '../llm/provider.js';
import {
  resolveAbs,
  projectWikiPath as defaultProjectWikiPath,
  projectDbPath as defaultProjectDbPath,
  personalWikiPath as defaultPersonalWikiPath,
  personalDbPath as defaultPersonalDbPath,
} from '../paths.js';
import { contradictionScan, type ContradictionResult } from './contradiction.js';

/**
 * `pinakes audit-wiki` — LLM-powered wiki audit command.
 *
 * Runs contradiction scan, gap detection, and generates an audit report.
 * This is the Tier 2 onboarding step — Pharos calls it during its
 * onboarding flow, or users run it manually.
 *
 * Requires an LLM provider (Ollama, API key, or CLI). Fails with a clear
 * error message if no provider is available.
 */

const GAP_MENTION_THRESHOLD = 10;
const MIN_TOPIC_LENGTH = 4; // filter out "or", "no", "id", etc.

export interface WikiAuditOptions {
  projectRoot?: string;
  dbPath?: string;
  scope?: 'project' | 'personal';
}

export interface WikiAuditResult {
  contradictions: ContradictionResult;
  gaps_found: number;
  stub_pages_created: string[];
  audit_report_path: string;
}

export async function auditWikiCommand(opts: WikiAuditOptions): Promise<WikiAuditResult> {
  const scope = opts.scope ?? 'project';
  const projectRoot = resolveAbs(opts.projectRoot ?? process.cwd());
  const wikiPath = scope === 'personal'
    ? defaultPersonalWikiPath()
    : defaultProjectWikiPath(projectRoot);
  const dbPath = opts.dbPath
    ? resolveAbs(opts.dbPath)
    : scope === 'personal'
      ? defaultPersonalDbPath()
      : defaultProjectDbPath(projectRoot);

  const bundle = openDb(dbPath);
  try {
    const llmProvider = createLlmProvider();

    // eslint-disable-next-line no-console
    console.log(`Running wiki audit (LLM provider: ${llmProvider.name})...`);

    // 1. Contradiction scan (requires LLM provider)
    let contradictions: ContradictionResult;
    if (llmProvider.available()) {
      // eslint-disable-next-line no-console
      console.log('  Scanning for contradictions...');
      contradictions = await contradictionScan({
        bundle,
        scope,
        llmProvider,
        wikiRoot: wikiPath,
      });

      if (contradictions.rate_limited) {
        // eslint-disable-next-line no-console
        console.log('  Contradiction scan rate-limited (last scan < 1h ago)');
      } else {
        // eslint-disable-next-line no-console
        console.log(
          `  Scanned ${contradictions.scanned_pairs} pairs, found ${contradictions.contradictions.length} contradictions`
        );
      }
    } else {
      // eslint-disable-next-line no-console
      console.log('  Skipping contradiction scan (no LLM provider available)');
      contradictions = { scanned_pairs: 0, contradictions: [], rate_limited: false };
    }

    // 2. Gap detection — filter out noise (short tokens, common words, code fragments)
    // eslint-disable-next-line no-console
    console.log('  Checking for documentation gaps...');
    const allGaps = queryGaps(bundle.writer, scope);
    const gaps = allGaps.filter((g) => isRealGap(g.topic));
    const significantGaps = gaps.filter((g) => g.mentions_count >= GAP_MENTION_THRESHOLD);
    // eslint-disable-next-line no-console
    console.log(`  Found ${gaps.length} gaps (${significantGaps.length} significant)`);

    // 3. Generate stub pages for significant gaps (if LLM available)
    const stubPages: string[] = [];
    if (significantGaps.length > 0 && llmProvider.available()) {
      // eslint-disable-next-line no-console
      console.log('  Generating stub pages for significant gaps...');
      const MAX_STUBS = 20;
      let generated = 0;
      for (const gap of significantGaps) {
        if (generated >= MAX_STUBS) break;
        try {
          const stubPath = await generateStubPage(gap, wikiPath, llmProvider);
          if (stubPath) {
            stubPages.push(stubPath);
            generated++;
            // eslint-disable-next-line no-console
            console.log(`    Created: ${stubPath.split('/').pop()}`);
          }
        } catch (err) {
          // eslint-disable-next-line no-console
          console.log(`    Failed: ${gap.topic} — ${err instanceof Error ? err.message.slice(0, 80) : err}`);
        }
      }
    }

    // 4. Generate audit report
    const reportPath = join(wikiPath, '_audit-report.md');
    writeAuditReport(reportPath, contradictions, gaps, significantGaps, stubPages);
    // eslint-disable-next-line no-console
    console.log(`\nAudit report written to: ${reportPath}`);

    return {
      contradictions,
      gaps_found: gaps.length,
      stub_pages_created: stubPages,
      audit_report_path: reportPath,
    };
  } finally {
    closeDb(bundle);
  }
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

async function generateStubPage(
  gap: GapRow,
  wikiRoot: string,
  llmProvider: LlmProvider,
): Promise<string | null> {
  const slug = gap.topic
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

  if (!slug) return null;

  const filePath = join(wikiRoot, `${slug}.md`);
  if (existsSync(filePath)) return null;

  const content = await llmProvider.complete({
    system:
      'You are a technical documentation writer. Generate a concise markdown stub page for a documentation topic. ' +
      'Include: a title (H1), a brief description, key questions to answer, and placeholder sections. ' +
      'Keep it under 500 words. Output only the markdown content.',
    prompt: `Generate a documentation stub for the topic: "${gap.topic}"\n\nThis topic has been referenced ${gap.mentions_count} times across the knowledge base but has no dedicated page.`,
    maxTokens: 1000,
  });

  writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

function writeAuditReport(
  reportPath: string,
  contradictions: ContradictionResult,
  allGaps: GapRow[],
  significantGaps: GapRow[],
  stubPages: string[],
): void {
  const lines = [
    '# Wiki Audit Report',
    '',
    `*Generated: ${new Date().toISOString()}*`,
    '',
    '## Summary',
    '',
  ];

  if (contradictions.rate_limited) {
    lines.push('- **Contradictions**: scan rate-limited (last scan < 1h ago)');
  } else {
    lines.push(`- **Contradictions**: ${contradictions.contradictions.length} found (${contradictions.scanned_pairs} pairs scanned)`);
  }
  lines.push(`- **Documentation gaps**: ${allGaps.length} total, ${significantGaps.length} significant (${GAP_MENTION_THRESHOLD}+ mentions)`);
  lines.push(`- **Stub pages generated**: ${stubPages.length}`);
  lines.push('');

  if (contradictions.contradictions.length > 0) {
    lines.push('## Contradictions');
    lines.push('');
    for (const c of contradictions.contradictions) {
      lines.push(`### ${c.chunkA.source_uri} vs ${c.chunkB.source_uri}`);
      lines.push('');
      lines.push(`- **Confidence**: ${c.confidence}`);
      lines.push(`- **Explanation**: ${c.explanation}`);
      lines.push(`- Chunk A: *"${truncate(c.chunkA.text, 150)}"*`);
      lines.push(`- Chunk B: *"${truncate(c.chunkB.text, 150)}"*`);
      lines.push('');
    }
  }

  if (significantGaps.length > 0) {
    lines.push('## Documentation Gaps');
    lines.push('');
    lines.push('| Topic | Mentions | Status |');
    lines.push('|---|---|---|');
    for (const g of significantGaps) {
      const status = g.resolved_at ? 'Resolved' : 'Open';
      lines.push(`| ${g.topic} | ${g.mentions_count} | ${status} |`);
    }
    lines.push('');
  }

  if (stubPages.length > 0) {
    lines.push('## Generated Stub Pages');
    lines.push('');
    for (const p of stubPages) {
      const name = p.split('/').pop() ?? p;
      lines.push(`- [[${name.replace('.md', '')}]]`);
    }
    lines.push('');
  }

  writeFileSync(reportPath, lines.join('\n'), 'utf-8');
}

function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen) + '...';
}

/**
 * Filter out noise from the gap detector. Rejects topics that are:
 * - Too short (common tokens like "or", "no", "id")
 * - Pure code fragments (paths, URLs, variable names with underscores)
 * - Common stopwords
 */
function isRealGap(topic: string): boolean {
  if (topic.length < MIN_TOPIC_LENGTH) return false;

  // Skip URLs, file paths, code fragments
  if (topic.startsWith('http') || topic.startsWith('/') || topic.startsWith('.')) return false;
  if (topic.includes('://')) return false;

  // Skip things that look like code (snake_case with no spaces, camelCase identifiers)
  if (/^[a-z_]+$/.test(topic) && topic.includes('_') && !topic.includes(' ')) return false;

  // Skip common stopwords that aren't real topics
  const stopwords = new Set([
    'the', 'and', 'for', 'with', 'that', 'this', 'from', 'are', 'was', 'will',
    'can', 'not', 'but', 'all', 'has', 'have', 'had', 'been', 'would', 'could',
    'should', 'may', 'might', 'must', 'shall', 'into', 'than', 'then', 'when',
    'where', 'which', 'while', 'about', 'after', 'before', 'between', 'under',
    'over', 'only', 'also', 'just', 'like', 'more', 'most', 'some', 'such',
    'each', 'every', 'both', 'either', 'neither', 'other', 'another',
    'true', 'false', 'null', 'none', 'yes', 'done',
  ]);
  if (stopwords.has(topic.toLowerCase())) return false;

  // Skip single-word topics that are too generic
  if (!topic.includes(' ') && topic.length < 6) return false;

  return true;
}
