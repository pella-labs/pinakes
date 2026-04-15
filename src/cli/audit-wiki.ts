import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Database as BetterSqliteDatabase } from 'better-sqlite3';

import { closeDb, openDb } from '../db/client.js';
import { queryGaps, type GapRow } from '../gaps/detector.js';
import { createLlmProvider, type LlmProvider } from '../llm/provider.js';
import {
  resolveAbs,
  resolveProjectRoot,
  projectWikiPath as defaultProjectWikiPath,
  projectDbPath as defaultProjectDbPath,
  personalWikiPath as defaultPersonalWikiPath,
  personalDbPath as defaultPersonalDbPath,
} from '../paths.js';
import { queryRecentlySuperseded, type SupersededClaim } from './claims.js';
import { contradictionScan, type ContradictionResult } from './contradiction.js';
import { createProgressReporter } from './progress.js';

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
const MIN_TOPIC_LENGTH = 5; // filter out short tokens (D42 tightened from 4)

export interface WikiAuditOptions {
  projectRoot?: string;
  dbPath?: string;
  scope?: 'project' | 'personal';
  quiet?: boolean;
  generateStubs?: boolean;
}

export interface WikiAuditResult {
  contradictions: ContradictionResult;
  gaps_found: number;
  topology_gaps: number;
  stubs_generated: number;
  superseded_claims: number;
  audit_report_path: string;
}

export async function auditWikiCommand(opts: WikiAuditOptions): Promise<WikiAuditResult> {
  const scope = opts.scope ?? 'project';
  const projectRoot = resolveProjectRoot(opts.projectRoot);
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
    const progress = createProgressReporter({ quiet: opts.quiet });

    // eslint-disable-next-line no-console
    console.log(`Running wiki audit (LLM provider: ${llmProvider.name})...`);

    // 1. Contradiction scan (requires LLM provider)
    let contradictions: ContradictionResult;
    if (llmProvider.available()) {
      progress.startPhase('Phase 1/3: Scanning for contradictions', 1);
      contradictions = await contradictionScan({
        bundle,
        scope,
        llmProvider,
        wikiRoot: wikiPath,
      });

      if (contradictions.rate_limited) {
        progress.endPhase('Rate-limited (last scan < 1h ago)');
      } else {
        progress.endPhase(
          `Scanned ${contradictions.scanned_pairs} pairs, found ${contradictions.contradictions.length} contradictions`
        );
      }
    } else {
      progress.startPhase('Phase 1/3: Contradiction scan', 0);
      progress.endPhase('Skipped (no LLM provider available)');
      contradictions = { scanned_pairs: 0, topics_scanned: 0, claims_extracted: 0, contradictions: [], rate_limited: false };
    }

    // 2. Gap detection — syntactic filter + LLM filter + graph topology (D42)
    const allGaps = queryGaps(bundle.writer, scope);
    const syntacticGaps = allGaps.filter((g) => isRealGap(g.topic));
    const significantGaps = syntacticGaps.filter((g) => g.mentions_count >= GAP_MENTION_THRESHOLD);

    progress.startPhase('Phase 2/3: Filtering documentation gaps', allGaps.length);

    // LLM batch filter (Tier 2)
    let filteredGaps: GapRow[];
    if (llmProvider.available() && significantGaps.length > 0) {
      filteredGaps = await llmFilterGaps(significantGaps, llmProvider, progress);
    } else {
      filteredGaps = significantGaps;
    }

    // Add graph topology gaps (high in-degree, no dedicated page)
    const topoGaps = findTopologyGaps(bundle.writer, scope);

    progress.endPhase(
      `${allGaps.length} raw → ${syntacticGaps.length} syntactic → ${filteredGaps.length} LLM-filtered, ${topoGaps.length} topology gaps`
    );

    // 3. Gather context for each confirmed gap
    const gapContexts = gatherGapContexts(bundle.writer, scope, filteredGaps);

    // 4. Opt-in synthesis stubs (D43 — --generate-stubs flag)
    let stubsGenerated = 0;
    if (opts.generateStubs && filteredGaps.length > 0 && llmProvider.available()) {
      stubsGenerated = await generateSynthesisStubs(
        filteredGaps,
        gapContexts,
        wikiPath,
        llmProvider,
        progress,
      );
    }

    // 5. Query recently superseded claims for "Claim Evolution" section (Phase 11.2)
    const lastAuditTs = bundle.writer
      .prepare<[string], { value: string }>(`SELECT value FROM pinakes_meta WHERE key = ?`)
      .get('last_audit_ts');
    const sinceTs = lastAuditTs ? parseInt(lastAuditTs.value, 10) : undefined;
    const supersededClaims = queryRecentlySuperseded(bundle.writer, scope, sinceTs);

    // 6. Generate audit report (D46 restructured: contradictions, gaps, health, claim evolution)
    const healthMetrics = getHealthMetrics(bundle.writer, scope);
    const reportPath = join(wikiPath, '_audit-report.md');
    writeAuditReport(reportPath, contradictions, filteredGaps, topoGaps, gapContexts, healthMetrics, stubsGenerated, supersededClaims);

    // Stamp audit timestamp for next run's "since" filter
    bundle.writer
      .prepare(`INSERT OR REPLACE INTO pinakes_meta (key, value) VALUES ('last_audit_ts', ?)`)
      .run(String(Date.now()));

    // eslint-disable-next-line no-console
    console.log(`\nAudit report written to: ${reportPath}`);

    return {
      contradictions,
      gaps_found: filteredGaps.length,
      topology_gaps: topoGaps.length,
      stubs_generated: stubsGenerated,
      superseded_claims: supersededClaims.length,
      audit_report_path: reportPath,
    };
  } finally {
    closeDb(bundle);
  }
}

// ---------------------------------------------------------------------------
// LLM gap filtering (D42 Tier 2)
// ---------------------------------------------------------------------------

const GAP_FILTER_SYSTEM = `You are a documentation quality analyst. Given a list of terms extracted from a technical wiki, identify which represent real documentation topics that would benefit from a dedicated wiki page.

Return ONLY a JSON array of the real topics: ["topic1", "topic2", ...]

Filter out:
- Common words and generic technical terms
- Code syntax, variable names, file extensions
- Terms too specific or too vague to be standalone pages
- Terms that are part of larger concepts already documented`;

const LLM_FILTER_BATCH_SIZE = 50;

export async function llmFilterGaps(
  gaps: GapRow[],
  llmProvider: LlmProvider,
  progress?: { tick: (label: string, detail?: string) => void },
): Promise<GapRow[]> {
  const result: GapRow[] = [];

  for (let i = 0; i < gaps.length; i += LLM_FILTER_BATCH_SIZE) {
    const batch = gaps.slice(i, i + LLM_FILTER_BATCH_SIZE);
    const topics = batch.map((g) => g.topic);

    try {
      const response = await llmProvider.complete({
        system: GAP_FILTER_SYSTEM,
        prompt: `Filter these ${topics.length} terms:\n${JSON.stringify(topics)}`,
        maxTokens: 1000,
      });

      const kept = parseLlmFilterResponse(response);
      const keptSet = new Set(kept.map((t) => t.toLowerCase()));

      for (const gap of batch) {
        if (keptSet.has(gap.topic.toLowerCase())) {
          result.push(gap);
        }
      }

      progress?.tick(`batch ${Math.floor(i / LLM_FILTER_BATCH_SIZE) + 1}`, `${kept.length}/${batch.length} kept`);
    } catch {
      // LLM filter failed — keep all gaps in this batch (graceful degradation)
      result.push(...batch);
      progress?.tick(`batch ${Math.floor(i / LLM_FILTER_BATCH_SIZE) + 1}`, 'LLM filter failed, keeping all');
    }
  }

  return result;
}

export function parseLlmFilterResponse(response: string): string[] {
  try {
    const fenceMatch = response.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    const jsonStr = fenceMatch ? fenceMatch[1]! : response;
    const arrMatch = jsonStr.match(/\[[\s\S]*\]/);
    if (!arrMatch) return [];
    const parsed = JSON.parse(arrMatch[0]) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((t): t is string => typeof t === 'string');
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Graph topology gaps (D42)
// ---------------------------------------------------------------------------

export interface TopologyGap {
  topic: string;
  in_degree: number;
  source: 'graph-topology';
}

export function findTopologyGaps(
  reader: BetterSqliteDatabase,
  scope: string,
): TopologyGap[] {
  // Find nodes referenced by wikilink edges that don't have their own page
  // We look for edge targets (dst_id) that appear frequently but
  // whose corresponding node titles don't exist as dedicated pages
  try {
    const rows = reader
      .prepare<[string, string], { title: string; cnt: number }>(
        `SELECT n.title, COUNT(*) as cnt
         FROM pinakes_edges e
         JOIN pinakes_nodes n ON e.dst_id = n.id
         WHERE n.scope = ? AND e.edge_kind = ?
         GROUP BY n.title
         HAVING cnt >= 3
         ORDER BY cnt DESC
         LIMIT 20`,
      )
      .all(scope, 'wikilink');

    return rows.map((r) => ({
      topic: r.title ?? 'untitled',
      in_degree: r.cnt,
      source: 'graph-topology' as const,
    }));
  } catch {
    return []; // Table might not have edges yet
  }
}

// ---------------------------------------------------------------------------
// Gap context gathering
// ---------------------------------------------------------------------------

export interface GapContext {
  topic: string;
  mentions: Array<{ source_uri: string; excerpt: string }>;
}

export function gatherGapContexts(
  reader: BetterSqliteDatabase,
  scope: string,
  gaps: GapRow[],
): GapContext[] {
  const contexts: GapContext[] = [];

  for (const gap of gaps.slice(0, 20)) {
    try {
      const mentions = reader
        .prepare<[string, string], { source_uri: string; text: string }>(
          `SELECT n.source_uri, c.text
           FROM pinakes_chunks c
           JOIN pinakes_nodes n ON c.node_id = n.id
           WHERE n.scope = ? AND c.text LIKE '%' || ? || '%' COLLATE NOCASE
           LIMIT 5`,
        )
        .all(scope, gap.topic);

      contexts.push({
        topic: gap.topic,
        mentions: mentions.map((m) => ({
          source_uri: m.source_uri,
          excerpt: truncate(m.text, 200),
        })),
      });
    } catch {
      // Non-fatal
    }
  }

  return contexts;
}

// ---------------------------------------------------------------------------
// Synthesis stubs (D43 — opt-in via --generate-stubs)
// ---------------------------------------------------------------------------

const SYNTHESIS_SYSTEM = `You are a technical documentation writer. Based on the following excerpts from a knowledge wiki, write a concise wiki page about the given topic.

Rules:
- Include ONLY facts present in the excerpts
- Mark any inferences with "(inferred)"
- Format as markdown with a title (H1), summary paragraph, and relevant details
- Keep it under 500 words
- Output only the markdown content`;

export async function generateSynthesisStubs(
  gaps: GapRow[],
  contexts: GapContext[],
  wikiRoot: string,
  llmProvider: LlmProvider,
  progress?: ReturnType<typeof createProgressReporter>,
): Promise<number> {
  mkdirSync(wikiRoot, { recursive: true });

  const MAX_STUBS = 20;
  const toGenerate = gaps.slice(0, MAX_STUBS);
  progress?.startPhase('Phase 3/3: Generating synthesis pages', toGenerate.length);

  let generated = 0;
  for (const gap of toGenerate) {
    const ctx = contexts.find((c) => c.topic === gap.topic);
    if (!ctx || ctx.mentions.length === 0) {
      progress?.tick(gap.topic, 'skipped (no context)');
      continue;
    }

    const slug = gap.topic
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');

    if (!slug) {
      progress?.tick(gap.topic, 'skipped (invalid slug)');
      continue;
    }

    const filePath = join(wikiRoot, `${slug}.md`);

    try {
      const excerpts = ctx.mentions
        .map((m) => `From ${m.source_uri}:\n${m.excerpt}`)
        .join('\n\n');

      const content = await llmProvider.complete({
        system: SYNTHESIS_SYSTEM,
        prompt: `Write a wiki page about "${gap.topic}" based on these excerpts:\n\n${excerpts}`,
        maxTokens: 1000,
      });

      // Add inferred confidence frontmatter — stubs are synthesized, not crystallized
      const frontmatter = '---\nconfidence: inferred\nsource: audit-wiki\n---\n\n';
      writeFileSync(filePath, frontmatter + content, 'utf-8');
      generated++;
      progress?.tick(gap.topic, 'page created');
    } catch (err) {
      progress?.tick(gap.topic, `failed: ${err instanceof Error ? err.message.slice(0, 60) : err}`);
    }
  }

  progress?.endPhase(`${generated} pages written to wiki`);
  return generated;
}

// ---------------------------------------------------------------------------
// Health metrics (D46)
// ---------------------------------------------------------------------------

export interface HealthMetrics {
  file_count: number;
  chunk_count: number;
  node_count: number;
  edge_count: number;
}

export function getHealthMetrics(
  reader: BetterSqliteDatabase,
  scope: string,
): HealthMetrics {
  const fileCount = reader.prepare<[string], { c: number }>(
    `SELECT COUNT(DISTINCT source_uri) as c FROM pinakes_nodes WHERE scope = ?`,
  ).get(scope)?.c ?? 0;

  const chunkCount = reader.prepare<[string], { c: number }>(
    `SELECT COUNT(*) as c FROM pinakes_chunks ch
     JOIN pinakes_nodes n ON ch.node_id = n.id WHERE n.scope = ?`,
  ).get(scope)?.c ?? 0;

  const nodeCount = reader.prepare<[string], { c: number }>(
    `SELECT COUNT(*) as c FROM pinakes_nodes WHERE scope = ?`,
  ).get(scope)?.c ?? 0;

  const edgeCount = reader.prepare<[string], { c: number }>(
    `SELECT COUNT(*) as c FROM pinakes_edges e
     JOIN pinakes_nodes n ON e.src_id = n.id WHERE n.scope = ?`,
  ).get(scope)?.c ?? 0;

  return { file_count: fileCount, chunk_count: chunkCount, node_count: nodeCount, edge_count: edgeCount };
}

// ---------------------------------------------------------------------------
// Audit report (D46 restructured)
// ---------------------------------------------------------------------------

function writeAuditReport(
  reportPath: string,
  contradictions: ContradictionResult,
  filteredGaps: GapRow[],
  topoGaps: TopologyGap[],
  gapContexts: GapContext[],
  health: HealthMetrics,
  stubsGenerated = 0,
  supersededClaims: SupersededClaim[] = [],
): void {
  const lines = [
    '# Wiki Audit Report',
    '',
    `*Generated: ${new Date().toISOString()}*`,
    '',
  ];

  // Section 1: Contradictions
  lines.push('## Contradictions');
  lines.push('');
  if (contradictions.rate_limited) {
    lines.push('*Scan rate-limited (last scan < 1h ago)*');
  } else if (contradictions.contradictions.length === 0) {
    lines.push(`*No contradictions found (${contradictions.topics_scanned} topics, ${contradictions.claims_extracted} claims scanned)*`);
  } else {
    lines.push(`**${contradictions.contradictions.length} contradictions found** (${contradictions.topics_scanned} topics scanned)`);
    lines.push('');
    for (const c of contradictions.contradictions) {
      lines.push(`### ${c.topic}`);
      lines.push('');
      lines.push(`- **${c.claimA.source_uri}**: "${truncate(c.claimA.claim, 150)}"`);
      lines.push(`- **${c.claimB.source_uri}**: "${truncate(c.claimB.claim, 150)}"`);
      lines.push(`- **Why**: ${c.explanation} *(${c.confidence} confidence)*`);
      lines.push('');
    }
  }
  lines.push('');

  // Section 2: Documentation Gaps
  lines.push('## Documentation Gaps');
  lines.push('');
  if (filteredGaps.length === 0 && topoGaps.length === 0) {
    lines.push('*No significant gaps found*');
  } else {
    if (filteredGaps.length > 0) {
      lines.push(`### By mention frequency (${filteredGaps.length} topics)`);
      lines.push('');
      lines.push('| Topic | Mentions | Context |');
      lines.push('|---|---|---|');
      for (const g of filteredGaps) {
        const ctx = gapContexts.find((c) => c.topic === g.topic);
        const ctxSummary = ctx?.mentions.length
          ? `Referenced in ${ctx.mentions.map((m) => m.source_uri).join(', ')}`
          : '';
        lines.push(`| ${g.topic} | ${g.mentions_count} | ${ctxSummary} |`);
      }
      lines.push('');
    }

    if (topoGaps.length > 0) {
      lines.push(`### By link topology (${topoGaps.length} topics)`);
      lines.push('');
      lines.push('| Topic | In-degree |');
      lines.push('|---|---|');
      for (const g of topoGaps) {
        lines.push(`| ${g.topic} | ${g.in_degree} |`);
      }
      lines.push('');
    }
  }
  lines.push('');

  // Section 3: Health Metrics
  lines.push('## Health Metrics');
  lines.push('');
  lines.push(`| Metric | Value |`);
  lines.push(`|---|---|`);
  lines.push(`| Files | ${health.file_count} |`);
  lines.push(`| Nodes | ${health.node_count} |`);
  lines.push(`| Chunks | ${health.chunk_count} |`);
  lines.push(`| Edges | ${health.edge_count} |`);
  lines.push('');

  // Section 4: Claim Evolution (Phase 11.2)
  lines.push('## Claim Evolution');
  lines.push('');
  if (supersededClaims.length === 0) {
    lines.push('*No claims superseded since last audit*');
  } else {
    lines.push(`**${supersededClaims.length} claims evolved** since last audit`);
    lines.push('');
    for (const sc of supersededClaims.slice(0, 20)) {
      const date = new Date(sc.superseded_at).toISOString().split('T')[0];
      if (sc.new_claim) {
        lines.push(`- **${sc.topic}** (${sc.source_uri}, ${date})`);
        lines.push(`  - Previously (v${sc.old_version}): "${truncate(sc.old_claim, 120)}"`);
        lines.push(`  - Now (v${sc.new_version}): "${truncate(sc.new_claim!, 120)}"`);
      } else {
        lines.push(`- **${sc.topic}** (${sc.source_uri}, ${date}) -- *retired*`);
        lines.push(`  - Was (v${sc.old_version}): "${truncate(sc.old_claim, 120)}"`);
      }
      lines.push('');
    }
  }
  lines.push('');

  // Generated drafts section
  if (stubsGenerated > 0) {
    lines.push('## Generated Drafts');
    lines.push('');
    lines.push(`${stubsGenerated} synthesis drafts written to \`_audit-drafts/\`. Review before promoting to wiki.`);
    lines.push('');
  } else {
    lines.push('---');
    lines.push('');
    lines.push('*Run with `--generate-stubs` to auto-generate draft pages for gaps.*');
    lines.push('');
  }

  writeFileSync(reportPath, lines.join('\n'), 'utf-8');
}

function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen) + '...';
}

/**
 * Filter out noise from the gap detector (D42 Tier 1 tightening).
 *
 * Rejects topics that are:
 * - Too short
 * - URLs, file paths, qualified names
 * - Code fragments (snake_case, camelCase, SCREAMING_SNAKE)
 * - Common stopwords (English + technical)
 * - Single-word generic terms that aren't proper nouns/acronyms
 */
export function isRealGap(topic: string): boolean {
  if (topic.length < MIN_TOPIC_LENGTH) return false;

  // Skip URLs, file paths, code fragments
  if (topic.startsWith('http') || topic.startsWith('/') || topic.startsWith('.')) return false;
  if (topic.includes('://')) return false;
  // Qualified names (e.g., "fs.readFileSync", "path.join")
  if (topic.includes('.') && !topic.includes(' ')) return false;

  // Skip code-like patterns
  // snake_case: all lowercase with underscores
  if (/^[a-z_]+$/.test(topic) && topic.includes('_')) return false;
  // camelCase: starts lowercase then has uppercase
  if (/^[a-z]+[A-Z]/.test(topic) && !topic.includes(' ')) return false;
  // SCREAMING_SNAKE_CASE
  if (/^[A-Z][A-Z0-9_]+$/.test(topic)) return false;

  const lower = topic.toLowerCase();

  // Skip common English stopwords
  if (STOPWORDS.has(lower)) return false;
  // Skip common technical terms that aren't real topics
  if (TECH_STOPWORDS.has(lower)) return false;

  // Single-word topics: only keep proper nouns/acronyms (starts with uppercase
  // or is all-caps like "OAuth2", "Docker", "PostgreSQL")
  if (!topic.includes(' ')) {
    const looksProper = /^[A-Z]/.test(topic);
    if (!looksProper) return false;
  }

  return true;
}

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'are', 'was', 'will',
  'can', 'not', 'but', 'all', 'has', 'have', 'had', 'been', 'would', 'could',
  'should', 'may', 'might', 'must', 'shall', 'into', 'than', 'then', 'when',
  'where', 'which', 'while', 'about', 'after', 'before', 'between', 'under',
  'over', 'only', 'also', 'just', 'like', 'more', 'most', 'some', 'such',
  'each', 'every', 'both', 'either', 'neither', 'other', 'another',
  'true', 'false', 'null', 'none', 'yes', 'done', 'note', 'using',
  'first', 'still', 'instead', 'enable', 'default', 'since', 'based',
  'here', 'there', 'these', 'those', 'above', 'below', 'through',
]);

const TECH_STOPWORDS = new Set([
  'example', 'section', 'configuration', 'implementation', 'method',
  'function', 'parameter', 'argument', 'option', 'value', 'result',
  'output', 'input', 'error', 'warning', 'status', 'type', 'string',
  'number', 'boolean', 'object', 'array', 'list', 'file', 'path',
  'name', 'version', 'update', 'change', 'create', 'delete', 'read',
  'write', 'server', 'client', 'request', 'response', 'source', 'model',
  'command', 'description', 'detail', 'content', 'window', 'provider',
  'module', 'package', 'import', 'export', 'return', 'class', 'interface',
  'property', 'field', 'table', 'column', 'index', 'query', 'schema',
  'handler', 'callback', 'promise', 'async', 'await', 'event', 'action',
  'state', 'props', 'component', 'render', 'route', 'endpoint', 'context',
  'scope', 'token', 'session', 'header', 'body', 'payload', 'message',
  'process', 'service', 'manager', 'factory', 'builder', 'helper',
  'utility', 'config', 'setting', 'feature', 'support', 'format',
  'connection', 'database', 'storage', 'cache', 'buffer', 'stream',
  'directory', 'folder', 'entry', 'record', 'document', 'resource',
]);
