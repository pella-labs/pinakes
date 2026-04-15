import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface MockDbState {
  nodes: Array<Record<string, unknown>>;
  edges: Array<Record<string, unknown>>;
  chunks: Array<Record<string, unknown>>;
  audit: Array<Record<string, unknown>>;
}

const { dbStates } = vi.hoisted(() => ({
  dbStates: new Map<string, MockDbState>(),
}));

function emptyState(): MockDbState {
  return { nodes: [], edges: [], chunks: [], audit: [] };
}

vi.mock('../../db/client.js', () => ({
  openDb(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    if (!existsSync(path)) {
      writeFileSync(path, '', 'utf-8');
      dbStates.set(path, emptyState());
    } else if (!dbStates.has(path)) {
      dbStates.set(path, emptyState());
    }

    const state = dbStates.get(path)!;
    const writer = {
      prepare(sql: string) {
        return {
          get(...args: unknown[]) {
            if (sql.includes('SELECT sqlite_version() AS v')) return { v: '3.51.3' };
            if (sql.includes("SELECT value FROM pinakes_meta WHERE key = 'schema_version'")) {
              return { value: '4' };
            }
            if (sql.includes("SELECT value FROM pinakes_meta WHERE key = 'last_full_rebuild'")) {
              return undefined;
            }

            const countMatch = sql.match(/SELECT count\(\*\) AS c FROM ([a-zA-Z0-9_]+)/);
            if (countMatch) {
              const table = countMatch[1]!;
              if (table === 'pinakes_nodes') return { c: state.nodes.length };
              if (table === 'pinakes_edges') return { c: state.edges.length };
              if (table === 'pinakes_chunks') return { c: state.chunks.length };
              if (table === 'pinakes_chunks_fts') return { c: state.chunks.length };
              if (table === 'pinakes_chunks_vec') return { c: state.chunks.length };
              if (table === 'pinakes_audit') return { c: state.audit.length };
              return { c: 0 };
            }

            throw new Error(`unexpected get SQL in mock DB: ${sql} / args=${JSON.stringify(args)}`);
          },

          all(limit?: number) {
            if (sql.includes('FROM pinakes_audit')) {
              const rows = [...state.audit];
              return typeof limit === 'number' ? rows.slice(0, limit) : rows;
            }
            if (sql.includes('SELECT * FROM pinakes_nodes')) return [...state.nodes];
            if (sql.includes('SELECT e.* FROM pinakes_edges')) return [...state.edges];
            if (sql.includes('SELECT c.* FROM pinakes_chunks')) return [...state.chunks];
            throw new Error(`unexpected all SQL in mock DB: ${sql}`);
          },

          run(...args: unknown[]) {
            if (sql.includes('INSERT OR REPLACE INTO pinakes_nodes')) {
              state.nodes.push({
                id: args[0],
                scope: args[1],
                source_uri: args[2],
                section_path: args[3],
                kind: args[4],
                title: args[5],
                content: args[6],
                source_sha: args[7],
                token_count: args[8],
              });
              return;
            }
            if (sql.includes('INSERT OR REPLACE INTO pinakes_edges')) {
              state.edges.push({
                src_id: args[0],
                dst_id: args[1],
                edge_kind: args[2],
              });
              return;
            }
            if (sql.includes('INSERT OR REPLACE INTO pinakes_chunks')) {
              state.chunks.push({
                id: args[0],
                node_id: args[1],
                chunk_index: args[2],
                text: args[3],
                chunk_sha: args[4],
                token_count: args[5],
              });
              return;
            }
            throw new Error(`unexpected run SQL in mock DB: ${sql}`);
          },
        };
      },
      exec() {
        // no-op transaction boundary for mocked importCommand writes
      },
    };

    return {
      path,
      writer,
      readers: [],
      drizzleWriter: {},
    };
  },

  closeDb() {
    // no-op
  },
}));

import { auditCommand } from '../../cli/audit.js';
import { exportCommand } from '../../cli/export.js';
import { importCommand } from '../../cli/import.js';
import { purgeCommand } from '../../cli/purge.js';
import { statusCommand } from '../../cli/status.js';
import { projectDbPath } from '../../paths.js';

describe('cli project-root path resolution', () => {
  let tmp: string;
  let projectRoot: string;
  let otherDir: string;
  let originalPinakesRoot: string | undefined;
  let originalCwd: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'pinakes-project-root-'));
    projectRoot = join(tmp, 'project');
    otherDir = join(tmp, 'elsewhere');
    mkdirSync(projectRoot, { recursive: true });
    mkdirSync(otherDir, { recursive: true });

    originalPinakesRoot = process.env['PINAKES_ROOT'];
    originalCwd = process.cwd();
    process.env['PINAKES_ROOT'] = join(tmp, 'pinakes-home');
    process.chdir(otherDir);

    dbStates.clear();
    const dbPath = projectDbPath(projectRoot);
    mkdirSync(dirname(dbPath), { recursive: true });
    writeFileSync(dbPath, '', 'utf-8');
    dbStates.set(dbPath, {
      nodes: [
        {
          id: 'node-1',
          scope: 'project',
          source_uri: 'README.md',
          section_path: 'README',
          kind: 'section',
          title: 'README',
          content: '# Readme',
          source_sha: 'sha',
          token_count: 5,
        },
      ],
      edges: [],
      chunks: [
        {
          id: 'chunk-1',
          node_id: 'node-1',
          chunk_index: 0,
          text: '# Readme',
          chunk_sha: 'chunk-sha',
          token_count: 5,
        },
      ],
      audit: [],
    });
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (originalPinakesRoot === undefined) {
      delete process.env['PINAKES_ROOT'];
    } else {
      process.env['PINAKES_ROOT'] = originalPinakesRoot;
    }
    dbStates.clear();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('status, audit, and export honor projectRoot outside the repo cwd', () => {
    const dbPath = projectDbPath(projectRoot);

    const statuses = statusCommand({ projectRoot });
    const project = statuses.find((status) => status.scope === 'project');
    expect(project?.dbPath).toBe(dbPath);
    expect(project?.exists).toBe(true);
    expect(project?.rowCounts['pinakes_nodes']).toBe(1);
    expect(project?.rowCounts['pinakes_chunks']).toBe(1);

    const auditRows = auditCommand({ projectRoot, scope: 'project' });
    expect(auditRows).toEqual([]);

    const exportData = exportCommand({ scope: 'project', projectRoot });
    expect(exportData.nodes.length).toBe(1);
    expect(exportData.chunks.length).toBe(1);
  });

  it('purge and import honor projectRoot when using the default DB path', () => {
    const dbPath = projectDbPath(projectRoot);
    const exportPath = join(tmp, 'project-export.json');
    const exportData = exportCommand({
      scope: 'project',
      projectRoot,
      out: exportPath,
    });

    expect(existsSync(dbPath)).toBe(true);

    const purgeResult = purgeCommand({
      scope: 'project',
      projectRoot,
      confirm: true,
    });
    expect(purgeResult.dbPath).toBe(dbPath);
    expect(purgeResult.deleted).toBe(true);
    expect(existsSync(dbPath)).toBe(false);

    const importResult = importCommand({
      scope: 'project',
      projectRoot,
      inFile: exportPath,
    });
    expect(importResult.nodes).toBe(exportData.nodes.length);
    expect(importResult.chunks).toBe(exportData.chunks.length);
    expect(existsSync(dbPath)).toBe(true);

    const statuses = statusCommand({ projectRoot });
    const project = statuses.find((status) => status.scope === 'project');
    expect(project?.exists).toBe(true);
    expect(project?.rowCounts['pinakes_nodes']).toBe(1);
  });
});
