import { cpSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';

import { logger } from '../observability/logger.js';

export interface CopyResult {
  files_copied: number;
  files_skipped: number;
  total_bytes: number;
}

/**
 * Copy markdown files from the project repo into the wiki directory,
 * preserving relative directory structure.
 *
 * Idempotent: skips files that already exist in the target. This allows
 * re-running `pinakes init` without overwriting curated wiki edits.
 *
 * @param files Absolute paths to source markdown files
 * @param projectRoot Absolute path to the project root
 * @param wikiRoot Absolute path to the wiki directory (`<project>/.pinakes/wiki/`)
 */
export function copyMarkdownToWiki(
  files: string[],
  projectRoot: string,
  wikiRoot: string,
): CopyResult {
  const result: CopyResult = { files_copied: 0, files_skipped: 0, total_bytes: 0 };

  for (const absPath of files) {
    const rel = relative(projectRoot, absPath);

    // Safety: skip files that resolve outside the project root
    if (rel.startsWith('..')) continue;

    const target = resolve(wikiRoot, rel);

    if (existsSync(target)) {
      result.files_skipped++;
      continue;
    }

    try {
      mkdirSync(dirname(target), { recursive: true });
      cpSync(absPath, target);
      const size = statSync(target).size;
      result.total_bytes += size;
      result.files_copied++;
    } catch (err) {
      logger.warn({ err, source: absPath, target }, 'failed to copy file to wiki');
    }
  }

  return result;
}
