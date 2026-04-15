#!/usr/bin/env node
import { serveCommand } from './cli/serve.js';
import { logger } from './observability/logger.js';

/**
 * Pinakes stdio server entry point.
 *
 * Phase 2 entry — replaces the Phase 1 `src/spike.ts`. The actual wiring lives
 * in `src/cli/serve.ts` so the CLI router and the production stdio entry
 * share one implementation. This file exists so that `pnpm run dev`
 * (`tsx watch src/server.ts`) and the published binary script (`bin/pinakes`)
 * have a stable, single-purpose entry without `pinakes serve` argv prefix gymnastics.
 *
 * Behavior:
 *   - Reads `--project-root`, `--db-path`, `--profile-path`,
 *     `--profile-db-path` from argv
 *   - Wiki lives at `<projectRoot>/.pinakes/wiki/` (auto-derived, not overridable)
 *   - Index data stored under `~/.pinakes/` (override with `PINAKES_ROOT`)
 *   - Boots the full Phase 2 stack (DB, embedder, chokidar watchers, MCP server)
 *   - Listens on stdio and runs forever until SIGTERM/SIGINT
 */

interface ParsedArgs {
  projectRoot?: string;
  dbPath?: string;
  profilePath?: string;
  profileDbPath?: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg) continue;
    if (arg === '--wiki-path' || arg.startsWith('--wiki-path=')) {
      throw new Error(
        '`--wiki-path` is no longer supported. Use `--project-root <repo>` and keep project knowledge in `<repo>/.pinakes/wiki/`.'
      );
    }
    if (arg === '--project-root' && argv[i + 1]) {
      out.projectRoot = argv[i + 1];
      i++;
    } else if (arg.startsWith('--project-root=')) {
      out.projectRoot = arg.slice('--project-root='.length);
    } else if (arg === '--db-path' && argv[i + 1]) {
      out.dbPath = argv[i + 1];
      i++;
    } else if (arg.startsWith('--db-path=')) {
      out.dbPath = arg.slice('--db-path='.length);
    } else if (arg === '--profile-path' && argv[i + 1]) {
      out.profilePath = argv[i + 1];
      i++;
    } else if (arg.startsWith('--profile-path=')) {
      out.profilePath = arg.slice('--profile-path='.length);
    } else if (arg === '--profile-db-path' && argv[i + 1]) {
      out.profileDbPath = argv[i + 1];
      i++;
    } else if (arg.startsWith('--profile-db-path=')) {
      out.profileDbPath = arg.slice('--profile-db-path='.length);
    }
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  await serveCommand({
    projectRoot: args.projectRoot,
    dbPath: args.dbPath,
    profilePath: args.profilePath,
    profileDbPath: args.profileDbPath,
  });
}

// Only run main when this file is invoked directly, not when imported by tests
// or by the CLI router. The argv[1] check works for both `tsx src/server.ts`
// and `node dist/server.js`.
const isMainModule = (() => {
  try {
    const argv1 = process.argv[1];
    if (!argv1) return false;
    const metaPath = new URL(import.meta.url).pathname;
    return metaPath === argv1 || metaPath.endsWith(argv1.replace(/^\.\//, ''));
  } catch {
    return false;
  }
})();

if (isMainModule) {
  main().catch((err) => {
    logger.error({ err }, 'pinakes fatal');
    process.exit(1);
  });
}
