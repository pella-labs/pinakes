# @pella-labs/pinakes

Local stdio MCP server that indexes a [Karpathy-style](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) two-level knowledge base (project + personal) into SQLite and exposes it to any coding LLM via [Cloudflare-style code-mode](https://blog.cloudflare.com/code-mode-mcp/).

**Two tools. One process. Works with any MCP client.**

- `knowledge_search` — hybrid FTS5 + vector search ranked by Reciprocal Rank Fusion
- `knowledge_query` — run JS in a QuickJS sandbox with `pinakes.project.*` bindings for search, graph traversal, wiki writes, and more

Markdown is canonical. SQLite is the index. If the index is corrupted or lost, rebuild it from markdown.

All data is stored under `~/.pinakes/` — nothing is written to your project directory.

Requires **Node.js 24 LTS** (`^24.10.0`).

## Install

### Claude Code

```bash
claude mcp add project-docs -- npx @pella-labs/pinakes serve --wiki-path ./docs
```

Or add to `.mcp.json`:

```json
{
  "mcpServers": {
    "project-docs": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@pella-labs/pinakes", "serve", "--wiki-path", "./docs"]
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
      - --wiki-path
      - ./docs
```

### Codex

```bash
export CODEX_MCP_SERVERS='{"project-docs":{"command":"npx","args":["-y","@pella-labs/pinakes","serve","--wiki-path","./docs"]}}'
```

### OpenCode

Add to `opencode.json`:

```json
{
  "mcp": {
    "project-docs": {
      "command": "npx",
      "args": ["-y", "@pella-labs/pinakes", "serve", "--wiki-path", "./docs"]
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
      "args": ["-y", "@pella-labs/pinakes", "serve", "--wiki-path", "./docs"]
    }
  }
}
```

## Quick start

```bash
# Create a docs directory in your project
mkdir -p docs
echo "# My Project" > docs/overview.md

# Start the server (indexes all .md files, watches for changes)
npx @pella-labs/pinakes serve --wiki-path ./docs
```

If you omit `--wiki-path`, the server creates a wiki directory at `~/.pinakes/projects/<project>/wiki/` automatically.

## Example queries

### Search

```
knowledge_search({ query: "authentication flow", scope: "project" })
```

### Execute (code-mode)

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
  code: `return pinakes.project.hybrid("deploy process")`,
  scope: "both"
})
```

## CLI commands

All data is stored under `~/.pinakes/` (override with `PINAKES_ROOT`). Project data lives at `~/.pinakes/projects/<mangled-path>/`.

```bash
npx @pella-labs/pinakes serve   [--wiki-path <dir>]   # Start the stdio MCP server
npx @pella-labs/pinakes rebuild [--wiki-path <dir>]   # Full rebuild from markdown
npx @pella-labs/pinakes status                        # Health check + row counts
npx @pella-labs/pinakes audit   [--n 20]              # Tail the audit log
npx @pella-labs/pinakes purge   --scope <s> --confirm # Delete a scope's DB
npx @pella-labs/pinakes export  --scope <s> [--out f] # Dump nodes + edges as JSON
npx @pella-labs/pinakes import  --scope <s> --in f    # Restore from dump
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
- **Two-level KG**: project knowledge base + personal knowledge base (`~/.pinakes/wiki/`), fully isolated by default
- **Privacy invariant**: personal KG bindings are only injected when `scope` includes `'personal'`
- **Budget gate**: every response stays under `max_tokens` (default 5000, hard cap 25000)
- **Deterministic IDs**: `sha1(scope + ':' + source_uri + ':' + section_path)` means re-indexing is idempotent
- **Centralized storage**: all data under `~/.pinakes/`, project paths mirrored as `~/.pinakes/projects/<mangled-path>/`

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
