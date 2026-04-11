import { resolve } from 'node:path';
import { closeDb, openDb } from '../db/client.js';
import { createLlmProvider } from '../llm/provider.js';
import { contradictionScan, type ContradictionResult } from './contradiction.js';

/**
 * CLI wrapper for the contradiction scan command.
 * Sets up DB connection and LLM provider, runs the scan, cleans up.
 */
export async function contradictionScanCommand(opts: {
  scope: 'project' | 'personal';
  wikiPath?: string;
  dbPath?: string;
}): Promise<ContradictionResult> {
  const wikiPath = resolve(opts.wikiPath ?? '.kg/wiki');
  const dbPath = opts.dbPath ?? resolve(wikiPath, '..', 'kg.db');

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
