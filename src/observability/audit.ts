import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Database as BetterSqliteDatabase } from 'better-sqlite3';

import { logger } from './logger.js';

/**
 * Audit log writer with scope-split JSONL mirror.
 *
 * Per CLAUDE.md §Security #7:
 *   - scope='project' → pinakes_audit table in ~/.pinakes/projects/<mangled>/pinakes.db + audit.jsonl
 *   - scope='personal' or 'both' → pinakes_audit table in ~/.pinakes/pinakes.db + ~/.pinakes/audit.jsonl
 *   - NEVER write personal query text to a path inside the project repo
 */

export interface AuditEntry {
  toolName: string;
  scopeRequested: string;
  callerCtx?: string;
  responseTokens?: number;
  error?: string;
}

/**
 * Write an audit row to the appropriate DB and mirror to JSONL.
 *
 * @param writer    The DB writer for the scope-appropriate bundle.
 * @param jsonlPath The path for the JSONL mirror file.
 * @param entry     Audit entry data.
 */
export function writeAuditRow(
  writer: BetterSqliteDatabase,
  jsonlPath: string | undefined,
  entry: AuditEntry
): void {
  const ts = Date.now();

  // Write to pinakes_audit table
  try {
    writer
      .prepare(
        `INSERT INTO pinakes_audit (ts, tool_name, scope_requested, caller_ctx, response_tokens, error)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        ts,
        entry.toolName,
        entry.scopeRequested,
        entry.callerCtx ?? null,
        entry.responseTokens ?? null,
        entry.error ?? null
      );
  } catch (err) {
    logger.warn({ err, entry }, 'failed to write pinakes_audit row');
  }

  // Mirror to JSONL
  if (jsonlPath) {
    try {
      const dir = dirname(jsonlPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      const line = JSON.stringify({ ts, ...entry }) + '\n';
      appendFileSync(jsonlPath, line, 'utf-8');
    } catch (err) {
      logger.warn({ err, jsonlPath }, 'failed to append audit JSONL');
    }
  }
}
