import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, normalize, resolve, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { Database as BetterSqliteDatabase } from 'better-sqlite3';

import { toStoredUri } from '../../ingest/manifest.js';
import { logger } from '../../observability/logger.js';

/**
 * Write-path bindings for `pinakes.project.write()`, `pinakes.project.append()`,
 * and `pinakes.project.remove()` (CLAUDE.md §Architecture #6, presearch D35).
 *
 * **Write contract**:
 *   1. Path containment: resolved path must start with `wikiRoot`
 *   2. Extension: only `.md` files
 *   3. Size: max `PINAKES_MAX_WRITE_SIZE` bytes (default 100KB)
 *   4. Rate: max 20 writes per `execute` call
 *   5. Atomic: tmp file + rename (never half-written files)
 *   6. Audit: every write appends to `pinakes_log`
 *
 * Chokidar picks up the written file and triggers re-indexing automatically.
 */

const MAX_WRITE_SIZE = parseInt(process.env['PINAKES_MAX_WRITE_SIZE'] ?? '102400', 10);
const MAX_WRITES_PER_CALL = 20;

/** Mutable counter shared across all write operations in a single pinakes_execute call. */
export interface WriteCounter {
  value: number;
}

// ============================================================================
// Path sanitization
// ============================================================================

/**
 * Sanitize and resolve a user-provided path against the wiki root.
 * Throws if the path escapes the wiki root or violates constraints.
 */
function sanitizePath(wikiRoot: string, rawPath: string): string {
  if (!rawPath || typeof rawPath !== 'string') {
    throw new Error('path is required and must be a non-empty string');
  }

  // Reject absolute paths
  if (isAbsolute(rawPath)) {
    throw new Error(`absolute paths are not allowed: ${rawPath}`);
  }

  // Normalize and check for .. traversal
  const normalized = normalize(rawPath);
  const parts = normalized.split(sep);
  if (parts.some((p) => p === '..')) {
    throw new Error(`path traversal (..) is not allowed: ${rawPath}`);
  }

  // Ensure .md extension
  if (!normalized.endsWith('.md')) {
    throw new Error(`only .md files can be written (got: ${rawPath})`);
  }

  // Resolve against wiki root
  const resolved = resolve(wikiRoot, normalized);

  // Containment check: resolved path must start with wikiRoot
  if (!resolved.startsWith(wikiRoot + sep) && resolved !== wikiRoot) {
    throw new Error(`path escapes wiki root: ${rawPath}`);
  }

  // Symlink check: if the target already exists, verify its real path
  if (existsSync(resolved)) {
    try {
      const stat = lstatSync(resolved);
      if (stat.isSymbolicLink()) {
        const real = realpathSync(resolved);
        if (!real.startsWith(wikiRoot + sep) && real !== wikiRoot) {
          throw new Error(`symlink escapes wiki root: ${rawPath} → ${real}`);
        }
      }
    } catch (e) {
      if ((e as Error).message.includes('escapes wiki root')) throw e;
      // lstat errors on non-existent files are fine
    }
  }

  return resolved;
}

// ============================================================================
// Rate limiting
// ============================================================================

function checkRateLimit(counter: WriteCounter): void {
  counter.value++;
  if (counter.value > MAX_WRITES_PER_CALL) {
    throw new Error(
      `write rate limit exceeded: max ${MAX_WRITES_PER_CALL} writes per pinakes_execute call (attempted #${counter.value})`
    );
  }
}

// ============================================================================
// Audit logging
// ============================================================================

function auditLog(
  writer: BetterSqliteDatabase,
  scope: string,
  kind: string,
  filePath: string,
  wikiRoot: string,
  payload: Record<string, unknown>
): void {
  try {
    writer
      .prepare(
        `INSERT INTO pinakes_log (ts, scope, kind, source_uri, payload)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(Date.now(), scope, kind, toStoredUri(filePath, wikiRoot, scope as 'project' | 'personal'), JSON.stringify(payload));
  } catch (err) {
    logger.warn({ err, kind, filePath }, 'failed to append write audit to pinakes_log');
  }
}

// ============================================================================
// Write operations
// ============================================================================

/**
 * Create or overwrite a wiki page. Atomic write via tmp + rename.
 *
 * @returns `{ path: string, bytes: number }` — the relative path and byte count.
 */
export function writeWikiFile(
  wikiRoot: string,
  rawPath: string,
  content: string,
  counter: WriteCounter,
  scope: string,
  writer: BetterSqliteDatabase
): { path: string; bytes: number } {
  checkRateLimit(counter);

  const resolved = sanitizePath(wikiRoot, rawPath);

  const bytes = Buffer.byteLength(content, 'utf-8');
  if (bytes > MAX_WRITE_SIZE) {
    throw new Error(
      `content exceeds max write size: ${bytes} bytes > ${MAX_WRITE_SIZE} bytes`
    );
  }

  // Ensure parent directory exists
  const dir = dirname(resolved);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  // Atomic write: write to tmp file, then rename
  const tmpPath = `${resolved}.tmp.${randomBytes(4).toString('hex')}`;
  try {
    writeFileSync(tmpPath, content, 'utf-8');
    renameSync(tmpPath, resolved);
  } catch (err) {
    // Clean up tmp file if rename failed
    try {
      if (existsSync(tmpPath)) unlinkSync(tmpPath);
    } catch { /* best effort */ }
    throw err;
  }

  // Relative path for the response
  const relativePath = resolved.slice(wikiRoot.length + 1);

  auditLog(writer, scope, 'write', resolved, wikiRoot, { bytes, relativePath });

  return { path: relativePath, bytes };
}

/**
 * Append a timestamped entry to `<wikiRoot>/log.md`.
 *
 * @returns `{ path: string, bytes: number }` — always `log.md`.
 */
export function appendWikiLog(
  wikiRoot: string,
  entry: string,
  counter: WriteCounter,
  scope: string,
  writer: BetterSqliteDatabase
): { path: string; bytes: number } {
  checkRateLimit(counter);

  if (!entry || typeof entry !== 'string') {
    throw new Error('entry is required and must be a non-empty string');
  }

  const logPath = resolve(wikiRoot, 'log.md');
  const timestamp = new Date().toISOString();
  const line = `- ${timestamp}: ${entry}\n`;

  const lineBytes = Buffer.byteLength(line, 'utf-8');
  if (lineBytes > MAX_WRITE_SIZE) {
    throw new Error(
      `entry exceeds max write size: ${lineBytes} bytes > ${MAX_WRITE_SIZE} bytes`
    );
  }

  // Read existing content (may not exist yet)
  let existing = '';
  if (existsSync(logPath)) {
    existing = readFileSync(logPath, 'utf-8');
  } else {
    existing = '# Turn log\n\n';
  }

  const newContent = existing + line;

  // Atomic write
  const tmpPath = `${logPath}.tmp.${randomBytes(4).toString('hex')}`;
  try {
    writeFileSync(tmpPath, newContent, 'utf-8');
    renameSync(tmpPath, logPath);
  } catch (err) {
    try {
      if (existsSync(tmpPath)) unlinkSync(tmpPath);
    } catch { /* best effort */ }
    throw err;
  }

  auditLog(writer, scope, 'append', logPath, wikiRoot, { entry, bytes: lineBytes });

  return { path: 'log.md', bytes: lineBytes };
}

/**
 * Remove a wiki page from disk. Chokidar `unlink` event triggers
 * ingester removal of the corresponding nodes/chunks.
 *
 * @returns `{ path: string, removed: true }`.
 */
export function removeWikiFile(
  wikiRoot: string,
  rawPath: string,
  counter: WriteCounter,
  scope: string,
  writer: BetterSqliteDatabase
): { path: string; removed: true } {
  checkRateLimit(counter);

  const resolved = sanitizePath(wikiRoot, rawPath);

  if (!existsSync(resolved)) {
    throw new Error(`file does not exist: ${rawPath}`);
  }

  const relativePath = resolved.slice(wikiRoot.length + 1);

  unlinkSync(resolved);

  auditLog(writer, scope, 'remove', resolved, wikiRoot, { relativePath });

  return { path: relativePath, removed: true };
}
