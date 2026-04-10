# Database Migration Strategies

## Types of Migration

### Schema-Only
Add columns, create tables, modify indexes. Usually backward-compatible if done carefully.

### Data Migration
Transform existing data. Often the riskiest part.

### Combined
Schema + data in a coordinated rollout.

## Expand-Contract Pattern

For zero-downtime migrations:

1. **Expand** — add the new column/table alongside the old one
2. **Migrate** — dual-write to both old and new; backfill existing data
3. **Contract** — remove the old column/table after all consumers have switched

## Tools

- **Flyway** — Java, versioned SQL files
- **Alembic** — Python/SQLAlchemy
- **Drizzle Kit** — TypeScript, our current choice
- **golang-migrate** — Go, SQL files
- **Liquibase** — XML/YAML/SQL, enterprise

## Rules

- Every migration must be reversible (include a down migration)
- Test migrations against a copy of production data
- Never modify a migration that has been applied to production

See [[database-sharding]], [[arch-020]].
