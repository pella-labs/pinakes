import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  writeFileSync,
} from 'node:fs';
import { join, relative } from 'node:path';

import { closeDb, openDb, type DbBundle } from '../db/client.js';
import { countTokens } from '../gate/budget.js';
import { createLlmProvider } from '../llm/provider.js';
import {
  resolveAbs,
  projectWikiPath as defaultProjectWikiPath,
  projectDbPath as defaultProjectDbPath,
} from '../paths.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DiffEntry {
  filePath: string;
  lines: string[];
  significantLines: number;
}

export interface CrystallizeOptions {
  projectRoot?: string;
  dbPath?: string;
  since?: string;
  commits?: number;
  include?: string[];
  exclude?: string[];
  minLines?: number;
  /** Injected LLM provider (tests). Default: createLlmProvider(). */
  llmProvider?: { name: string; available(): boolean; complete(o: { system: string; prompt: string; maxTokens: number }): Promise<string> };
}

export interface CrystallizeResult {
  drafts_created: number;
  output_dir: string;
  skipped_reason?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_EXCLUDES = [
  '*.test.ts', '*.spec.ts', '*.lock', '*-lock.json',
  'node_modules/', 'dist/', '*.map',
];
const DEFAULT_MIN_LINES = 10;
const MAX_DIFF_TOKENS = 50_000;

// ---------------------------------------------------------------------------
// Diff parsing
// ---------------------------------------------------------------------------

/**
 * Split a unified diff into per-file entries. Each entry carries the file
 * path, the raw lines, and a count of "significant" changed lines (non-blank
 * additions/deletions, excluding the `+++`/`---` header lines).
 */
export function parseDiff(diffOutput: string): DiffEntry[] {
  const entries: DiffEntry[] = [];
  const sections = diffOutput.split(/^(?=diff --git )/m);

  for (const section of sections) {
    if (!section.trim()) continue;

    const plusMatch = section.match(/^\+\+\+ b\/(.+)$/m);
    if (!plusMatch) continue;

    const filePath = plusMatch[1]!;
    const lines = section.split('\n');

    let significantLines = 0;
    for (const line of lines) {
      if (
        (line.startsWith('+') || line.startsWith('-')) &&
        !line.startsWith('+++') &&
        !line.startsWith('---')
      ) {
        if (line.slice(1).trim().length > 0) {
          significantLines++;
        }
      }
    }

    entries.push({ filePath, lines, significantLines });
  }

  return entries;
}

// ---------------------------------------------------------------------------
// Diff filtering
// ---------------------------------------------------------------------------

function matchesPattern(filePath: string, pattern: string): boolean {
  if (pattern.endsWith('/')) {
    return filePath.includes(pattern) || filePath.startsWith(pattern);
  }
  if (pattern.startsWith('*')) {
    return filePath.endsWith(pattern.slice(1));
  }
  return filePath === pattern;
}

export function filterDiff(
  entries: DiffEntry[],
  opts: { include?: string[]; exclude?: string[] } = {},
): DiffEntry[] {
  const excludes = opts.exclude ?? DEFAULT_EXCLUDES;
  const includes = opts.include;

  return entries.filter((entry) => {
    for (const pattern of excludes) {
      if (matchesPattern(entry.filePath, pattern)) return false;
    }
    if (includes && includes.length > 0) {
      return includes.some((p) => matchesPattern(entry.filePath, p));
    }
    return true;
  });
}

// ---------------------------------------------------------------------------
// Diff truncation
// ---------------------------------------------------------------------------

export function truncateDiff(diffText: string, maxTokens: number): string {
  const tc = countTokens(diffText);
  if (tc <= maxTokens) return diffText;
  const ratio = maxTokens / tc;
  const cutAt = Math.floor(diffText.length * ratio);
  return diffText.slice(0, cutAt) + '\n\n[... diff truncated due to size ...]';
}

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

export function getGitDiff(
  projectRoot: string,
  opts: { since?: string; commits?: number },
): { diff: string; commits: string[] } {
  const cwd = projectRoot;

  let diffArgs: string[];
  if (opts.since) {
    diffArgs = ['diff', `HEAD@{${opts.since}}`, 'HEAD'];
  } else {
    const n = opts.commits ?? 1;
    diffArgs = ['diff', `HEAD~${n}..HEAD`];
  }

  const diff = execFileSync('git', diffArgs, {
    cwd,
    encoding: 'utf-8',
    maxBuffer: 10 * 1024 * 1024,
  });

  let logArgs: string[];
  if (opts.since) {
    logArgs = ['log', `--since=${opts.since}`, '--format=%H'];
  } else {
    const n = opts.commits ?? 1;
    logArgs = ['log', `-${n}`, '--format=%H'];
  }

  const logOutput = execFileSync('git', logArgs, { cwd, encoding: 'utf-8' });
  const commits = logOutput.trim().split('\n').filter(Boolean);

  return { diff, commits };
}

/**
 * Get current git HEAD SHA. Returns null if not a git repo or git fails.
 */
export function getGitHead(projectRoot: string): string | null {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: projectRoot,
      encoding: 'utf-8',
    }).trim();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// LLM prompt + parsing
// ---------------------------------------------------------------------------

const CRYSTALLIZE_SYSTEM = `You are a technical documentation writer distilling a coding session into wiki knowledge pages.

Given a git diff and optional existing wiki context, identify the most important decisions, learnings, and architectural changes. For each, produce a wiki page.

Rules:
- Focus on WHY decisions were made, not just WHAT changed
- Each page should be self-contained and useful to a future developer
- Use markdown format with a clear H1 title
- Include rationale/context sections
- Reference relevant source files
- Don't document trivial changes (formatting, typos, simple renames)
- Output pages separated by a line containing only "---PAGE_BREAK---"
- Each page should start with an H1 heading on the first line
- Keep each page under 500 words`;

function buildPrompt(
  diffText: string,
  wikiContext: string,
  commits: string[],
): string {
  let prompt = `## Git Diff (commits: ${commits.join(', ')})\n\n\`\`\`diff\n${diffText}\n\`\`\`\n`;
  if (wikiContext) {
    prompt += `\n## Existing Wiki Context (avoid duplicating this)\n\n${wikiContext}\n`;
  }
  prompt += '\nDistill the significant decisions and learnings from this diff into wiki pages.';
  return prompt;
}

export function parseLlmDrafts(
  response: string,
): Array<{ title: string; content: string }> {
  const pages = response.split(/^---PAGE_BREAK---$/m);
  const drafts: Array<{ title: string; content: string }> = [];

  for (const page of pages) {
    const trimmed = page.trim();
    if (!trimmed) continue;
    const titleMatch = trimmed.match(/^#\s+(.+)$/m);
    const title = titleMatch ? titleMatch[1]!.trim() : 'untitled';
    drafts.push({ title, content: trimmed });
  }

  return drafts;
}

// ---------------------------------------------------------------------------
// Draft writing (directly to wiki root)
// ---------------------------------------------------------------------------

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/^#+\s*/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 80);
}

function writeWikiPage(
  wikiRoot: string,
  title: string,
  content: string,
  commits: string[],
): string {
  const slug = slugify(title);
  if (!slug) return '';

  const frontmatter = [
    '---',
    'confidence: crystallized',
    `source: crystallize`,
    `crystallized_at: ${new Date().toISOString()}`,
    `source_commits: [${commits.join(', ')}]`,
    '---',
    '',
  ].join('\n');

  const filePath = join(wikiRoot, `${slug}.md`);
  writeFileSync(filePath, frontmatter + content, 'utf-8');
  return filePath;
}

// ---------------------------------------------------------------------------
// Wiki context
// ---------------------------------------------------------------------------

function getWikiContext(bundle: DbBundle): string {
  try {
    const reader = bundle.readers[0] ?? bundle.writer;
    const rows = reader
      .prepare(
        `SELECT title, source_uri, substr(content, 1, 300) as content
         FROM pinakes_nodes
         WHERE scope = 'project'
         ORDER BY updated_at DESC
         LIMIT 10`,
      )
      .all() as Array<{ title: string | null; source_uri: string; content: string }>;

    if (rows.length === 0) return '';
    return rows
      .map((r) => `### ${r.title ?? r.source_uri}\n${r.content}`)
      .join('\n\n');
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Main: crystallize (direct wiki write)
// ---------------------------------------------------------------------------

export async function crystallizeCommand(
  opts: CrystallizeOptions,
): Promise<CrystallizeResult> {
  const projectRoot = resolveAbs(opts.projectRoot ?? process.cwd());
  const wikiRoot = defaultProjectWikiPath(projectRoot);

  // 1. Git diff
  let gitResult: { diff: string; commits: string[] };
  try {
    gitResult = getGitDiff(projectRoot, {
      since: opts.since,
      commits: opts.commits,
    });
  } catch (err) {
    return {
      drafts_created: 0,
      output_dir: wikiRoot,
      skipped_reason: `git diff failed: ${err instanceof Error ? err.message : err}`,
    };
  }

  if (!gitResult.diff.trim()) {
    return {
      drafts_created: 0,
      output_dir: wikiRoot,
      skipped_reason: 'no changes found in git diff',
    };
  }

  // 2. Parse + filter
  const allEntries = parseDiff(gitResult.diff);
  const filtered = filterDiff(allEntries, {
    include: opts.include,
    exclude: opts.exclude,
  });

  // 3. Min lines check
  const minLines = opts.minLines ?? DEFAULT_MIN_LINES;
  const totalSignificant = filtered.reduce(
    (sum, e) => sum + e.significantLines,
    0,
  );
  if (totalSignificant < minLines) {
    return {
      drafts_created: 0,
      output_dir: wikiRoot,
      skipped_reason: `only ${totalSignificant} significant lines (minimum: ${minLines})`,
    };
  }

  // 4. Reconstruct filtered diff, truncate if needed
  let diffText = filtered
    .map((e) => e.lines.join('\n'))
    .join('\n');
  diffText = truncateDiff(diffText, MAX_DIFF_TOKENS);

  // 5. Wiki context
  const dbPath = opts.dbPath
    ? resolveAbs(opts.dbPath)
    : defaultProjectDbPath(projectRoot);

  let wikiContext = '';
  if (existsSync(dbPath)) {
    const bundle = openDb(dbPath);
    try {
      wikiContext = getWikiContext(bundle);
    } finally {
      closeDb(bundle);
    }
  }

  // 6. LLM call
  const llm = opts.llmProvider ?? createLlmProvider();
  if (!llm.available()) {
    return {
      drafts_created: 0,
      output_dir: wikiRoot,
      skipped_reason: 'no LLM provider available',
    };
  }

  const prompt = buildPrompt(diffText, wikiContext, gitResult.commits);
  let response: string;
  try {
    response = await llm.complete({
      system: CRYSTALLIZE_SYSTEM,
      prompt,
      maxTokens: 4000,
    });
  } catch (err) {
    return {
      drafts_created: 0,
      output_dir: wikiRoot,
      skipped_reason: `LLM call failed: ${err instanceof Error ? err.message : err}`,
    };
  }

  // 7. Parse + write directly to wiki
  const drafts = parseLlmDrafts(response);
  if (drafts.length === 0) {
    return {
      drafts_created: 0,
      output_dir: wikiRoot,
      skipped_reason: 'LLM produced no draft pages',
    };
  }

  mkdirSync(wikiRoot, { recursive: true });

  let created = 0;
  for (const draft of drafts) {
    const path = writeWikiPage(
      wikiRoot,
      draft.title,
      draft.content,
      gitResult.commits,
    );
    if (path) {
      created++;
      // eslint-disable-next-line no-console
      console.error(`  wiki: ${relative(wikiRoot, path)}`);
    }
  }

  return { drafts_created: created, output_dir: wikiRoot };
}
