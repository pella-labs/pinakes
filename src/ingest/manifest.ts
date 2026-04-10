import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { Database as BetterSqliteDatabase } from 'better-sqlite3';

import { logger } from '../observability/logger.js';

/**
 * Consistency manifest for KG-MCP Phase 2.
 *
 * Lives at:
 *   - `<wikiPath>/../kg-manifest.json` for project scope
 *     (e.g. `.pharos/kg-manifest.json` next to `.pharos/wiki/`)
 *   - `<profilePath>/kg-manifest.json` for personal scope
 *     (e.g. `~/.pharos/profile/kg-manifest.json`)
 *
 * **What it stores**: per ingested file, the file-level `source_sha` and
 * the list of per-chunk `chunk_shas` that ingest produced. This is the
 * mid-ingest crash recovery surface — if the process dies during a vec
 * insert, the manifest may disagree with the DB on startup, and the
 * consistency check (`checkConsistency`) detects which files need re-ingest.
 *
 * **Why we need this**: pre-v1 sqlite-vec has untested crash semantics
 * (presearch.md F9). The DB may end up in a state where vec rows exist for
 * a chunk_sha that doesn't match the on-disk file. The manifest is the
 * tiebreaker — it records what we INTENDED to be on disk. On startup we
 * compare it against the actual on-disk markdown file_sha; mismatches mean
 * the file was edited externally (or the previous run crashed before
 * completing). Either way, re-ingest is the right move.
 *
 * **Atomic writes**: writeManifest() writes to a tmpfile and renames over
 * the target. SQLite uses the same pattern; rename is atomic on Linux/macOS
 * for files on the same filesystem. This avoids the failure mode where a
 * SIGKILL mid-write leaves a half-written manifest that fails to parse on
 * the next startup.
 *
 * **Format**: JSON, hand-readable, future-proofed with a `version` field
 * so we can detect old manifests if the structure ever changes (e.g. adding
 * per-chunk embedding metadata).
 */

const MANIFEST_VERSION = 1;

export interface ManifestEntry {
  /** sha1 of the entire source file */
  source_sha: string;
  /** Ordered list of chunk shas (one per chunk produced by the chunker) */
  chunk_shas: string[];
}

export interface Manifest {
  version: number;
  /** Maps absolute file paths → entry */
  files: Record<string, ManifestEntry>;
}

/**
 * Build an empty manifest. Useful for cold starts and tests.
 */
export function emptyManifest(): Manifest {
  return { version: MANIFEST_VERSION, files: {} };
}

/**
 * Read a manifest from disk. Returns an empty manifest if the file doesn't
 * exist or is unreadable. Logs a warning on parse errors but doesn't throw —
 * a corrupted manifest is treated as "no manifest", and the consistency
 * check will conservatively re-ingest everything (which is correct).
 */
export function readManifest(path: string): Manifest {
  if (!existsSync(path)) return emptyManifest();
  try {
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw) as Manifest;
    if (typeof parsed !== 'object' || parsed === null) return emptyManifest();
    if (parsed.version !== MANIFEST_VERSION) {
      logger.warn(
        { path, foundVersion: parsed.version, expectedVersion: MANIFEST_VERSION },
        'manifest version mismatch — discarding'
      );
      return emptyManifest();
    }
    if (typeof parsed.files !== 'object' || parsed.files === null) {
      return emptyManifest();
    }
    return parsed;
  } catch (err) {
    logger.warn({ err, path }, 'failed to parse manifest — starting fresh');
    return emptyManifest();
  }
}

/**
 * Write a manifest atomically. Creates the parent directory if missing.
 * The write is tmpfile + rename, so a SIGKILL mid-write either leaves the
 * old manifest intact or replaces it with the new one — never half-written.
 */
export function writeManifest(path: string, manifest: Manifest): void {
  const abs = resolve(path);
  mkdirSync(dirname(abs), { recursive: true });
  const tmp = `${abs}.tmp.${process.pid}.${Date.now()}`;
  const json = JSON.stringify(manifest, null, 2);
  writeFileSync(tmp, json, 'utf8');
  renameSync(tmp, abs);
}

/**
 * Update one entry in a manifest in-memory. Mutates the input and returns it
 * (the caller is expected to follow up with `writeManifest`). The entry's
 * key is the absolute path to the file as it was ingested.
 */
export function updateManifestEntry(
  manifest: Manifest,
  filePath: string,
  entry: ManifestEntry
): Manifest {
  const abs = resolve(filePath);
  manifest.files[abs] = entry;
  return manifest;
}

/**
 * Drop a file from the manifest (e.g. after a `file:removed` event).
 */
export function removeManifestEntry(manifest: Manifest, filePath: string): Manifest {
  const abs = resolve(filePath);
  delete manifest.files[abs];
  return manifest;
}

/**
 * Compute the sha1 of a file's contents on disk. Used by `checkConsistency`
 * and the ingester. Synchronous because we're already in the single-flight
 * path and parallelizing this against itself buys nothing.
 */
export function fileSha(filePath: string): string {
  const buf = readFileSync(filePath);
  return createHash('sha1').update(buf).digest('hex');
}

/**
 * Walk a wiki directory recursively and return absolute paths of all *.md
 * files in deterministic (sorted) order. Used by both the consistency check
 * and the rebuild CLI.
 */
export function listMarkdownFiles(rootDir: string): string[] {
  const out: string[] = [];
  const stack = [resolve(rootDir)];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      const full = join(dir, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        stack.push(full);
      } else if (st.isFile() && name.toLowerCase().endsWith('.md')) {
        out.push(full);
      }
    }
  }
  out.sort();
  return out;
}

/**
 * Compare an in-memory manifest against the current on-disk state of a wiki
 * directory. Returns a list of file paths that need re-ingestion:
 *   - Files present on disk that are NOT in the manifest (new or unindexed)
 *   - Files present in BOTH but with mismatched `source_sha` (edited externally,
 *     or last ingest crashed mid-flight before the manifest could be updated)
 *   - Files where the manifest says "indexed" but the DB has zero rows (DB/manifest
 *     divergence — e.g. DB was recreated, migration dropped tables, or crash
 *     between COMMIT and manifest write left the manifest ahead of the DB)
 *
 * When DB/manifest divergence is detected for a file, its manifest entry is
 * cleared so the ingester's manifest fast-path won't noop the re-ingest.
 *
 * Files that exist in the manifest but no longer on disk are NOT returned —
 * they're deletions, handled separately by the chokidar `file:removed`
 * pathway in Pass 3. The startup consistency check is for additions and
 * mutations, not removals.
 *
 * **Performance**: O(N) over markdown files, one stat + sha per file, plus
 * one lightweight COUNT query per file that passes the manifest check when
 * a DB writer is provided. For a typical wiki of <100 files this is <100ms.
 */
export function checkConsistency(
  manifest: Manifest,
  rootDir: string,
  writer?: BetterSqliteDatabase
): string[] {
  const stale: string[] = [];
  const files = listMarkdownFiles(rootDir);

  // Pre-build a set of indexed source_uris for O(1) lookup when DB is available.
  // A single query is cheaper than N per-file COUNT queries.
  let indexedUris: Set<string> | null = null;
  if (writer) {
    try {
      const rows = writer
        .prepare('SELECT DISTINCT source_uri FROM kg_nodes')
        .all() as Array<{ source_uri: string }>;
      indexedUris = new Set(rows.map((r) => r.source_uri));
    } catch (err) {
      logger.warn({ err }, 'checkConsistency: failed to query kg_nodes — falling back to manifest-only');
    }
  }

  for (const f of files) {
    const entry = manifest.files[f];
    const onDiskSha = fileSha(f);
    if (!entry || entry.source_sha !== onDiskSha) {
      stale.push(f);
    } else if (indexedUris) {
      // Manifest says this file is current — verify the DB agrees.
      const sourceUri = pathToFileURL(resolve(f)).href;
      if (!indexedUris.has(sourceUri)) {
        logger.info(
          { file: f },
          'checkConsistency: manifest says indexed but DB has no rows — marking stale'
        );
        // Clear the manifest entry so the ingester's fast-path doesn't noop.
        delete manifest.files[f];
        stale.push(f);
      }
    }
  }
  return stale;
}

/**
 * Compute the canonical manifest path for a given wiki directory and scope.
 *
 * - `'project'` → `<wikiPath>/../kg-manifest.json`
 *   (lives next to the wiki dir, inside the same `.pharos/` folder)
 * - `'personal'` → `<wikiPath>/../kg-manifest.json` as well
 *   (lives next to `~/.pharos/profile/wiki/`, in `~/.pharos/profile/`)
 *
 * Both scopes use the same relative shape — the difference is the wikiPath
 * the caller passes in.
 */
export function manifestPathFor(wikiPath: string): string {
  return resolve(dirname(resolve(wikiPath)), 'kg-manifest.json');
}
