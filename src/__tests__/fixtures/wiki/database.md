# Database layer

## Connection strategy

We use `better-sqlite3` with a single writer and two reader connections. WAL
journal mode is mandatory; without it, concurrent readers block the writer.

The writer connection is enforced at the app layer — there is no pool on the
writer side. Attempts to open a second writer in the same process throw
immediately rather than silently serializing.

## Schema ownership

Pharos owns `pharos.db` at `<projectDir>/.pharos/pharos.db`. KG-MCP extends
the same file with its own tables via a drizzle-kit migration — we do not
create a separate database file for project-scope data.

Personal-scope data lives in a separate file at `~/.pharos/profile/kg.db` to
enforce the privacy boundary at the filesystem level.
