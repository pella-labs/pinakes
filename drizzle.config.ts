import type { Config } from 'drizzle-kit';

/**
 * Drizzle Kit config for KG-MCP.
 *
 * Schema source: src/db/schema.ts (8 logical tables + kg_meta).
 *
 * Migrations land in src/db/migrations as `<n>_<name>.sql` plus a journal
 * file. We hand-edit the initial migration to append the FTS5 + sqlite-vec
 * virtual tables (drizzle-kit doesn't emit virtual table DDL).
 *
 * No `dbCredentials` here on purpose — the runtime DB path is passed in via
 * the `kg serve` / `kg rebuild` CLI flags (default `<wikiPath>/../kg.db`),
 * not stamped at migration-generation time.
 */
export default {
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'sqlite',
  strict: true,
  verbose: true,
} satisfies Config;
