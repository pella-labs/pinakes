# @pella-labs/pinakes

Local stdio MCP server that indexes a [Karpathy-style](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) two-level knowledge base (project + personal) into SQLite and exposes it to any coding LLM via [Cloudflare-style code-mode](https://blog.cloudflare.com/code-mode-mcp/).

**Two tools. One process. Works with any MCP client.**

- `knowledge_search` — hybrid FTS5 + vector search ranked by Reciprocal Rank Fusion
- `knowledge_query` — run JS in a QuickJS sandbox with `pinakes.project.*` bindings for search, graph traversal, wiki writes, and more

Markdown is canonical. SQLite is the index. If the index is corrupted or lost, rebuild it from markdown.

Project knowledge lives in your repo at `.pinakes/wiki/` and is meant to be curated there. Project index data lives under `~/.pinakes/projects/<mangled-path>/`. Personal knowledge lives under `~/.pinakes/`.

Requires **Node.js 24 LTS** (`^24.10.0`).

## Install

### Claude Code

```bash
claude mcp add project-docs -- npx @pella-labs/pinakes serve --project-root .
```

Or add to `.mcp.json`:

```json
{
  "mcpServers": {
    "project-docs": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@pella-labs/pinakes", "serve", "--project-root", "."]
    }
  }
}
```

### Goose

Add to `~/.config/goose/profiles.yaml`:

```yaml
extensions:
  project-docs:
    name: project-docs
    type: stdio
    cmd: npx
    args:
      - "@pella-labs/pinakes"
      - serve
      - --project-root
      - .
```

### Codex

```bash
export CODEX_MCP_SERVERS='{"project-docs":{"command":"npx","args":["-y","@pella-labs/pinakes","serve","--project-root","."]}}'
```

### OpenCode

Add to `opencode.json`:

```json
{
  "mcp": {
    "project-docs": {
      "command": "npx",
      "args": ["-y", "@pella-labs/pinakes", "serve", "--project-root", "."]
    }
  }
}
```

### Cursor

Add to Cursor settings (Settings > MCP Servers):

```json
{
  "mcpServers": {
    "project-docs": {
      "command": "npx",
      "args": ["-y", "@pella-labs/pinakes", "serve", "--project-root", "."]
    }
  }
}
```

These examples assume the MCP client launches the server from the repository root. If it does not, replace `.` with an absolute repo path.

## Quick start

```bash
# Create a project knowledge page
mkdir -p .pinakes/wiki
echo "# My Project" > .pinakes/wiki/overview.md

# Start the server for the current repo
npx @pella-labs/pinakes serve --project-root .
```

If `.pinakes/wiki/` does not exist, the first `serve` bootstraps it once from markdown files already in your repo, respecting `.pinakesignore`. There is no continuous repo-to-wiki mirroring after that.

Startup also creates `.pinakes/.gitignore`, `.pinakesignore`, and appends a Pinakes instruction block to `CLAUDE.md` / `AGENTS.md` if needed.

If you previously used `--wiki-path`, move that content into `.pinakes/wiki/` and switch to `--project-root`.

After bootstrap, edit `.pinakes/wiki/` directly. If you later tighten `.pinakesignore`, run `pinakes clean-wiki` to prune previously imported files.

## Example queries

### knowledge_search

```
knowledge_search({ query: "authentication flow", scope: "project" })
```

### knowledge_query (code-mode)

```javascript
// Browse the knowledge base index
knowledge_query({ code: `return pinakes.project.index()` })

// Full-text search
knowledge_query({ code: `return pinakes.project.fts("bcrypt")` })

// Node lookup + neighbors
knowledge_query({ code: `
  const node = pinakes.project.get("sha1-id-here");
  const neighbors = pinakes.project.neighbors(node.id, { depth: 2 });
  return { node, neighbors };
` })

// Write a knowledge page
knowledge_query({ code: `
  return pinakes.project.write("decisions/use-postgres.md", "# Use PostgreSQL\\nWe chose Postgres because...");
` })

// Find under-documented areas
knowledge_query({ code: `return pinakes.project.gaps()` })

// Query across both scopes
knowledge_query({
  code: `return {
    project: pinakes.project.hybrid("deploy process"),
    personal: pinakes.personal.hybrid("deploy process")
  }`,
  scope: "both"
})
```

## CLI commands

Project knowledge lives in `<project-root>/.pinakes/wiki/`. Project index data lives at `~/.pinakes/projects/<mangled-path>/` (override root with `PINAKES_ROOT`). Personal data lives directly under `~/.pinakes/`.

```bash
npx @pella-labs/pinakes serve              [--project-root <dir>]                     # Start the stdio MCP server
npx @pella-labs/pinakes rebuild            [--project-root <dir>] [--scope <s>]       # Full rebuild from markdown
npx @pella-labs/pinakes status             [--project-root <dir>]                     # Health check + row counts
npx @pella-labs/pinakes audit              [--project-root <dir>] [--n 20]            # Tail the audit log
npx @pella-labs/pinakes audit-wiki         [--project-root <dir>]                     # Wiki audit (contradictions, gaps)
npx @pella-labs/pinakes clean-wiki         [--project-root <dir>]                     # Remove wiki files that now match .pinakesignore
npx @pella-labs/pinakes purge              --scope <s> --confirm [--project-root <dir>]
npx @pella-labs/pinakes export             --scope <s> [--out f] [--project-root <dir>]
npx @pella-labs/pinakes import             --scope <s> --in f [--project-root <dir>]
npx @pella-labs/pinakes contradiction-scan [--project-root <dir>] [--scope <s>]
npx @pella-labs/pinakes crystallize        [--project-root <dir>] [--commits <n>]
```

## Embedder configuration

The default embedder is bundled (`Xenova/all-MiniLM-L6-v2`, 384 dimensions, runs locally). You can upgrade via environment variables:

### Ollama (local, free)

```bash
export PINAKES_EMBED_PROVIDER=ollama
export PINAKES_OLLAMA_URL=http://localhost:11434
export PINAKES_OLLAMA_MODEL=nomic-embed-text
```

### Voyage AI (cloud, paid)

```bash
export PINAKES_EMBED_PROVIDER=voyage
export PINAKES_VOYAGE_API_KEY=your-key-here
```

### OpenAI (cloud, paid)

```bash
export PINAKES_EMBED_PROVIDER=openai
export PINAKES_OPENAI_API_KEY=your-key-here
```

Changing the embedder requires a full rebuild (`pinakes rebuild`) since the vector dimensions change.

## Architecture

- **Single process**: MCP server, file watcher, SQLite writer, read pool, embedder, and QuickJS sandbox all in one Node process
- **Single writer, multi reader**: one writer connection + 2 reader connections per DB, WAL mode
- **Two-level KG**: project knowledge base in `.pinakes/wiki/` + personal knowledge base in `~/.pinakes/wiki/`, fully isolated by default
- **Privacy invariant**: personal KG bindings are only injected when `scope` includes `'personal'`
- **Budget gate**: every response stays under `max_tokens` (default 5000, hard cap 25000)
- **Deterministic IDs**: `sha1(scope + ':' + source_uri + ':' + section_path)` means re-indexing is idempotent
- **Split storage**: project knowledge markdown in-repo at `.pinakes/wiki/`; project index artifacts under `~/.pinakes/projects/<mangled-path>/`
- **Bootstrap, not mirroring**: first run can import existing repo markdown into `.pinakes/wiki/`, but repo files and wiki files are not kept in sync afterwards

## Wiki auditing

Two paths for auditing your knowledge base:

**Claude Code users** — run `/audit-wiki` for a deep agent-powered audit. This runs the pipeline first, then has Claude read through wiki files to find cross-file contradictions, broken references, terminology inconsistencies, and stale info that the pipeline can't catch.

**All users** — run `npx @pella-labs/pinakes audit-wiki` (or `pnpm run pinakes -- audit-wiki` from source) for the deterministic pipeline audit. Produces `_audit-report.md` in the wiki directory with contradictions, documentation gaps, and health metrics. Requires an LLM provider (Ollama, API key, or `claude` CLI).

## Development

```bash
git clone https://github.com/pella-labs/pinakes.git && cd pinakes
pnpm install
pnpm run dev              # Watch mode
pnpm run test             # Run tests (vitest)
pnpm run test:privacy     # Privacy adversarial suite (merge blocker)
pnpm run test:budget      # Budget gate adversarial suite
pnpm run typecheck        # tsc --noEmit
pnpm run lint             # eslint
```

## License

[MIT](LICENSE)
