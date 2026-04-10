import { afterAll, describe, it, expect, beforeAll } from 'vitest';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { closeDb, openDb, nextReader, type DbBundle } from '../../db/client.js';
import { Repository } from '../../db/repository.js';
import { IngesterService, __resetSingleFlightForTests } from '../../ingest/ingester.js';
import { CountingEmbedder, getDefaultEmbedder } from '../../retrieval/embedder.js';
import { QuickJSExecutor } from '../../sandbox/executor.js';
import { makeKgExecuteHandler } from '../../mcp/tools/execute.js';
import { makeKgSearchHandler } from '../../mcp/tools/search.js';
import { writeAuditRow } from '../../observability/audit.js';

/**
 * Phase 5 non-adversarial scope tests (10 tests).
 */

const FIXTURE_DIR = resolve(
  fileURLToPath(new URL('../fixtures/wiki', import.meta.url))
);

let projectBundle: DbBundle;
let personalBundle: DbBundle;
let repository: Repository;
let embedder: CountingEmbedder;
let executor: QuickJSExecutor;
let tmpRoot: string;
let projectWiki: string;
let personalWiki: string;

function makeExecHandler() {
  return makeKgExecuteHandler({
    repository, executor,
    bundle: projectBundle, embedder,
    wikiRoot: projectWiki,
    personalBundle,
    personalWikiRoot: personalWiki,
  });
}

function makeSearchHandler() {
  return makeKgSearchHandler({
    repository, embedder,
    bundle: projectBundle,
    personalBundle,
  });
}

function parseEnvelope(response: { content: [{ type: 'text'; text: string }] }) {
  return JSON.parse(response.content[0]?.text ?? '');
}

beforeAll(async () => {
  __resetSingleFlightForTests();

  tmpRoot = mkdtempSync(join(tmpdir(), 'kg-scope-'));

  projectWiki = join(tmpRoot, 'project-wiki');
  mkdirSync(projectWiki, { recursive: true });
  for (const name of readdirSync(FIXTURE_DIR)) {
    copyFileSync(join(FIXTURE_DIR, name), join(projectWiki, name));
  }

  personalWiki = join(tmpRoot, 'personal-wiki');
  mkdirSync(personalWiki, { recursive: true });
  writeFileSync(join(personalWiki, 'secrets.md'), '# Personal Secrets\n\nMy secret password is hunter2.\n');
  writeFileSync(join(personalWiki, 'notes.md'), '# Personal Notes\n\nPrivate notes about my work.\n');

  projectBundle = openDb(join(tmpRoot, 'project.db'));
  personalBundle = openDb(join(tmpRoot, 'personal.db'));

  embedder = new CountingEmbedder(getDefaultEmbedder());
  await embedder.warmup();

  const projectIngester = new IngesterService(projectBundle, embedder, 'project', projectWiki);
  for (const name of readdirSync(projectWiki)) {
    if (name.endsWith('.md')) await projectIngester.ingestFile(join(projectWiki, name));
  }

  const personalIngester = new IngesterService(personalBundle, embedder, 'personal', personalWiki);
  for (const name of readdirSync(personalWiki)) {
    if (name.endsWith('.md')) await personalIngester.ingestFile(join(personalWiki, name));
  }

  repository = new Repository(projectBundle, personalBundle);
  executor = new QuickJSExecutor();
  await executor.warmup();
}, 60_000);

afterAll(() => {
  executor?.dispose();
  if (projectBundle) closeDb(projectBundle);
  if (personalBundle) closeDb(personalBundle);
  if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
  __resetSingleFlightForTests();
});

// ============================================================================
// Non-adversarial scope tests (10 tests)
// ============================================================================

describe('scope behavior (non-adversarial)', () => {
  it('1. kg.describe() returns project + personal counts for scope=both', async () => {
    const handler = makeExecHandler();
    const res = await handler({ code: `return kg.describe()`, scope: 'both' });
    const env = parseEnvelope(res);
    expect(env.result).toHaveProperty('project');
    expect(env.result).toHaveProperty('personal');
    expect(env.result.project.chunks).toBeGreaterThan(0);
    expect(env.result.personal.chunks).toBeGreaterThan(0);
  });

  it('2. kg.describe() hides personal key for scope=project', async () => {
    const handler = makeExecHandler();
    const res = await handler({ code: `return kg.describe()`, scope: 'project' });
    const env = parseEnvelope(res);
    expect(env.result).toHaveProperty('project');
    expect(env.result).not.toHaveProperty('personal');
  });

  it('3. personal DB absent → project queries work fine', async () => {
    const handler = makeKgExecuteHandler({
      repository: new Repository(projectBundle),
      executor, bundle: projectBundle, embedder, wikiRoot: projectWiki,
    });
    const res = await handler({ code: `return kg.project.fts('bcrypt').length`, scope: 'project' });
    const env = parseEnvelope(res);
    expect(env.result).toBeGreaterThan(0);
  });

  it('4. scope=project → kg.personal.write("x", "leak") throws', async () => {
    const handler = makeExecHandler();
    const res = await handler({
      code: `try { kg.personal.write('x', 'leak'); return 'LEAKED'; } catch(e) { return 'blocked: ' + String(e); }`,
      scope: 'project',
    });
    const env = parseEnvelope(res);
    expect(env.result).not.toContain('LEAKED');
  });

  it('5. kg.personal.fts() works in scope=personal', async () => {
    const handler = makeExecHandler();
    const res = await handler({
      code: `return kg.personal.fts('secret').length`,
      scope: 'personal',
    });
    const env = parseEnvelope(res);
    expect(env.result).toBeGreaterThan(0);
  });

  it('6. kg.personal.write() works in scope=personal', async () => {
    const handler = makeExecHandler();
    const res = await handler({
      code: `return kg.personal.write('test-write.md', '# Test\\n\\nWritten from personal scope.')`,
      scope: 'personal',
    });
    const env = parseEnvelope(res);
    expect(env.result).toHaveProperty('path');
    expect(env.result.path).toBe('test-write.md');

    // Verify file exists on disk
    expect(existsSync(join(personalWiki, 'test-write.md'))).toBe(true);

    // Cleanup
    rmSync(join(personalWiki, 'test-write.md'), { force: true });
  });

  it('7. source_scope on every result from scope=both in kg_search', async () => {
    const handler = makeSearchHandler();
    const res = await handler({ query: 'password', scope: 'both' });
    const env = parseEnvelope(res);
    // Should have results from both scopes
    expect(env.result.length).toBeGreaterThan(0);
    // Every result should have source_scope
    for (const item of env.result) {
      if ('too_large' in item) continue;
      expect(item).toHaveProperty('source_scope');
      expect(['project', 'personal']).toContain(item.source_scope);
    }
  });

  it('8. audit JSONL split: personal scope writes to separate path', () => {
    const projectJsonl = join(tmpRoot, 'project-audit.jsonl');
    const personalJsonl = join(tmpRoot, 'personal-audit.jsonl');

    // Write a project audit row
    writeAuditRow(projectBundle.writer, projectJsonl, {
      toolName: 'kg_execute',
      scopeRequested: 'project',
      responseTokens: 100,
    });

    // Write a personal audit row
    writeAuditRow(personalBundle.writer, personalJsonl, {
      toolName: 'kg_execute',
      scopeRequested: 'personal',
      responseTokens: 50,
    });

    // Project JSONL should have project entry
    const projectContent = readFileSync(projectJsonl, 'utf-8');
    expect(projectContent).toContain('"scopeRequested":"project"');
    expect(projectContent).not.toContain('"scopeRequested":"personal"');

    // Personal JSONL should have personal entry
    const personalContent = readFileSync(personalJsonl, 'utf-8');
    expect(personalContent).toContain('"scopeRequested":"personal"');
  });

  it('9. project and personal can coexist', async () => {
    const handler = makeExecHandler();
    const res = await handler({
      code: `
        var pCount = kg.project.fts('auth').length;
        var nCount = kg.personal.fts('secret').length;
        return { project: pCount, personal: nCount };
      `,
      scope: 'both',
    });
    const env = parseEnvelope(res);
    expect(env.result.project).toBeGreaterThan(0);
    expect(env.result.personal).toBeGreaterThan(0);
  });

  it('10. personal scope requested without personal DB → error', async () => {
    const noPersonalHandler = makeKgExecuteHandler({
      repository: new Repository(projectBundle),
      executor, bundle: projectBundle, embedder, wikiRoot: projectWiki,
    });
    const res = await noPersonalHandler({ code: `return 1`, scope: 'personal' });
    const env = parseEnvelope(res);
    expect(env.result).toHaveProperty('error');
    expect(env.result.error).toContain('personal scope requested');
  });
});
