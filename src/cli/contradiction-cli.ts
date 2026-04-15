import { closeDb, openDb } from '../db/client.js';
import { createLlmProvider } from '../llm/provider.js';
import {
  resolveAbs,
  resolveProjectRoot,
  projectWikiPath as defaultProjectWikiPath,
  projectDbPath as defaultProjectDbPath,
  personalWikiPath as defaultPersonalWikiPath,
  personalDbPath as defaultPersonalDbPath,
} from '../paths.js';
import { contradictionScan, type ContradictionResult } from './contradiction.js';

/**
 * CLI wrapper for the contradiction scan command.
 * Sets up DB connection and LLM provider, runs the scan, cleans up.
 */
export async function contradictionScanCommand(opts: {
  scope: 'project' | 'personal';
  projectRoot?: string;
  dbPath?: string;
}): Promise<ContradictionResult> {
  const projectRoot = resolveProjectRoot(opts.projectRoot);
  const wikiPath = opts.scope === 'personal'
    ? defaultPersonalWikiPath()
    : defaultProjectWikiPath(projectRoot);
  const dbPath = opts.dbPath
    ? resolveAbs(opts.dbPath)
    : opts.scope === 'personal'
      ? defaultPersonalDbPath()
      : defaultProjectDbPath(projectRoot);

  const bundle = openDb(dbPath);
  try {
    const llmProvider = createLlmProvider();
    return await contradictionScan({
      bundle,
      scope: opts.scope,
      llmProvider,
      wikiRoot: wikiPath,
    });
  } finally {
    closeDb(bundle);
  }
}
