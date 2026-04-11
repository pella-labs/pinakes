#!/usr/bin/env node
import { auditCommand, renderAudit } from './audit.js';
import { contradictionScanCommand } from './contradiction-cli.js';
import { exportCommand, renderExport } from './export.js';
import { importCommand, renderImport } from './import.js';
import { purgeCommand, renderPurge } from './purge.js';
import { rebuildCommand } from './rebuild.js';
import { renderStatus, statusCommand } from './status.js';
import { serveCommand } from './serve.js';
import { logger } from '../observability/logger.js';

/**
 * `pinakes` CLI router for Pinakes Phase 2.
 *
 * Tiny manual arg parser — no `commander`/`yargs` dep, per CLAUDE.md tech
 * stack rule "Do not add new dependencies without justification."
 *
 * Subcommands:
 *   pinakes serve   --wiki-path <dir> [--db-path] [--profile-path] [--profile-db-path]
 *   pinakes rebuild --wiki-path <dir> [--db-path] [--scope project|personal|both]
 *   pinakes status  [--db-path <path>] [--wiki-path <dir>] [--profile-db-path <path>]
 */

type Flags = Record<string, string | true>;

function parseFlags(argv: string[]): { flags: Flags; positional: string[] } {
  const flags: Flags = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg.startsWith('--')) {
      const eqIdx = arg.indexOf('=');
      if (eqIdx > 0) {
        flags[arg.slice(2, eqIdx)] = arg.slice(eqIdx + 1);
      } else {
        const next = argv[i + 1];
        if (next && !next.startsWith('--')) {
          flags[arg.slice(2)] = next;
          i++;
        } else {
          flags[arg.slice(2)] = true;
        }
      }
    } else {
      positional.push(arg);
    }
  }
  return { flags, positional };
}

function getString(flags: Flags, key: string): string | undefined {
  const v = flags[key];
  return typeof v === 'string' ? v : undefined;
}

function getRequiredString(flags: Flags, key: string): string {
  const v = getString(flags, key);
  if (!v) throw new Error(`missing required flag: --${key}`);
  return v;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const subcommand = argv[0];
  const { flags } = parseFlags(argv.slice(1));

  switch (subcommand) {
    case 'serve': {
      await serveCommand({
        projectRoot: getString(flags, 'project-root'),
        wikiPath: getString(flags, 'wiki-path'),
        dbPath: getString(flags, 'db-path'),
        profilePath: getString(flags, 'profile-path'),
        profileDbPath: getString(flags, 'profile-db-path'),
      });
      break;
    }

    case 'rebuild': {
      const scope = getString(flags, 'scope') as
        | 'project'
        | 'personal'
        | 'both'
        | undefined;
      const summaries = await rebuildCommand({
        projectRoot: getString(flags, 'project-root'),
        wikiPath: getString(flags, 'wiki-path'),
        dbPath: getString(flags, 'db-path'),
        profilePath: getString(flags, 'profile-path'),
        profileDbPath: getString(flags, 'profile-db-path'),
        scope,
      });
      for (const s of summaries) {
        // eslint-disable-next-line no-console
        console.log(
          `${s.scope.padEnd(8)} files=${s.files} nodes=${s.nodes} ` +
            `chunks_added=${s.chunks_added} chunks_skipped=${s.chunks_skipped} ` +
            `embedder_calls=${s.embedder_calls} duration=${s.durationMs}ms`
        );
      }
      break;
    }

    case 'status': {
      const statuses = statusCommand({
        dbPath: getString(flags, 'db-path'),
        wikiPath: getString(flags, 'wiki-path'),
        profileDbPath: getString(flags, 'profile-db-path'),
      });
      // eslint-disable-next-line no-console
      console.log(renderStatus(statuses));
      break;
    }

    case 'audit': {
      const rows = auditCommand({
        n: getString(flags, 'n') ? parseInt(getString(flags, 'n')!, 10) : undefined,
        dbPath: getString(flags, 'db-path'),
        wikiPath: getString(flags, 'wiki-path'),
        profileDbPath: getString(flags, 'profile-db-path'),
        scope: (getString(flags, 'scope') as 'project' | 'personal') ?? undefined,
      });
      // eslint-disable-next-line no-console
      console.log(renderAudit(rows));
      break;
    }

    case 'purge': {
      const scope = getRequiredString(flags, 'scope') as 'project' | 'personal';
      const result = purgeCommand({
        scope,
        confirm: flags['confirm'] === true,
        dbPath: getString(flags, 'db-path'),
        wikiPath: getString(flags, 'wiki-path'),
        profileDbPath: getString(flags, 'profile-db-path'),
      });
      // eslint-disable-next-line no-console
      console.log(renderPurge(result));
      break;
    }

    case 'export': {
      const scope = getRequiredString(flags, 'scope') as 'project' | 'personal';
      const out = getString(flags, 'out');
      const data = exportCommand({
        scope,
        out,
        dbPath: getString(flags, 'db-path'),
        wikiPath: getString(flags, 'wiki-path'),
        profileDbPath: getString(flags, 'profile-db-path'),
      });
      if (!out) {
        // eslint-disable-next-line no-console
        console.log(JSON.stringify(data, null, 2));
      } else {
        // eslint-disable-next-line no-console
        console.log(renderExport(data, out));
      }
      break;
    }

    case 'import': {
      const scope = getRequiredString(flags, 'scope') as 'project' | 'personal';
      const result = importCommand({
        scope,
        inFile: getRequiredString(flags, 'in'),
        dbPath: getString(flags, 'db-path'),
        wikiPath: getString(flags, 'wiki-path'),
        profileDbPath: getString(flags, 'profile-db-path'),
      });
      // eslint-disable-next-line no-console
      console.log(renderImport(result));
      break;
    }

    case 'contradiction-scan': {
      const scope = (getString(flags, 'scope') ?? 'project') as 'project' | 'personal';
      const result = await contradictionScanCommand({
        scope,
        wikiPath: getString(flags, 'wiki-path'),
        dbPath: getString(flags, 'db-path'),
      });
      if (result.rate_limited) {
        // eslint-disable-next-line no-console
        console.log('Rate limited — last scan was less than 1 hour ago.');
      } else {
        // eslint-disable-next-line no-console
        console.log(
          `Scanned ${result.scanned_pairs} pairs, found ${result.contradictions.length} contradictions.`
        );
        if (result.contradictions.length > 0) {
          // eslint-disable-next-line no-console
          console.log('Wrote contradictions.md to wiki root.');
        }
      }
      break;
    }

    case undefined:
    case 'help':
    case '-h':
    case '--help': {
      // eslint-disable-next-line no-console
      console.log(`pinakes — Pinakes CLI

All project data is stored under ~/.pinakes/projects/<mangled-project-root>/.
Personal data is stored under ~/.pinakes/. Set PINAKES_ROOT to override.

Usage:
  pinakes serve   [--project-root <dir>] [--wiki-path <dir>] [--db-path <path>] [--profile-path <dir>] [--profile-db-path <path>]
  pinakes rebuild [--project-root <dir>] [--wiki-path <dir>] [--db-path <path>] [--scope project|personal|both]
  pinakes status  [--project-root <dir>] [--db-path <path>] [--profile-db-path <path>]
  pinakes audit   [--n <count>] [--scope project|personal] [--project-root <dir>] [--db-path <path>]
  pinakes purge   --scope <project|personal> --confirm [--project-root <dir>] [--db-path <path>]
  pinakes export  --scope <project|personal> [--out file.json] [--project-root <dir>] [--db-path <path>]
  pinakes import  --scope <project|personal> --in file.json [--project-root <dir>] [--db-path <path>]
  pinakes contradiction-scan [--scope project|personal] [--project-root <dir>] [--wiki-path <dir>] [--db-path <path>]`);
      break;
    }

    default:
      throw new Error(`unknown subcommand: ${subcommand}`);
  }
}

main().catch((err) => {
  logger.error({ err }, 'pinakes cli failed');
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
