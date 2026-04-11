# @pella-labs/pinakes

Local stdio MCP server that indexes a [Karpathy-style](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) two-level knowledge wiki (project + personal) into SQLite and exposes it to any coding LLM via [Cloudflare-style code-mode](https://blog.cloudflare.com/code-mode-mcp/).

**Two tools. One process. Works with any MCP client.**

- `search` — hybrid FTS5 + vector search ranked by Reciprocal Rank Fusion
- `execute` — run JS in a QuickJS sandbox with `pinakes.project.*` bindings for search, graph traversal, wiki writes, and more

Markdown is canonical. SQLite is the index. If the index is corrupted or lost, rebuild it from markdown.

Requires **Node.js 24 LTS** (`^24.10.0`).

## Install

### Claude Code

```bash
claude mcp add pinakes -- npx @pella-labs/pinakes serve --wiki-path ./wiki
```

Or add to `.claude/settings.json`:

```json
{
  "mcpServers": {
    "pinakes": {
      "command": "npx",
      "args": ["@pella-labs/pinakes", "serve", "--wiki-path", "./wiki"]
    }
  }
}
```

### Goose

Add to `~/.config/goose/profiles.yaml`:

```yaml
extensions:
  pinakes:
    name: pinakes
    type: stdio
    cmd: npx
    args:
      - "@pella-labs/pinakes"
      - serve
      - --wiki-path
      - ./wiki
```

### Codex

```bash
export CODEX_MCP_SERVERS='{"pinakes":{"command":"npx","args":["@pella-labs/pinakes","serve","--wiki-path","./wiki"]}}'
```

### OpenCode

Add to `opencode.json`:

```json
{
  "mcp": {
    "pinakes": {
      "command": "npx",
      "args": ["@pella-labs/pinakes", "serve", "--wiki-path", "./wiki"]
    }
  }
}
```

### Cursor

Add to Cursor settings (Settings > MCP Servers):

```json
{
  "mcpServers": {
    "pinakes": {
      "command": "npx",
      "args": ["@pella-labs/pinakes", "serve", "--wiki-path", "./wiki"]
    }
  }
}
```

## Quick start

```bash
# Create a wiki directory in your project
mkdir -p wiki
echo "# My Project" > wiki/overview.md

# Test it directly
npx @pella-labs/pinakes serve --wiki-path ./wiki
```

The server indexes all `.md` files in the wiki directory, watches for changes, and serves them over stdio.

## Example queries

### Search

```
search({ query: "authentication flow", scope: "project" })
```

### Execute (code-mode)

```javascript
// Browse the wiki index
execute({ code: `return pinakes.project.index()` })

// Full-text search
execute({ code: `return pinakes.project.fts("bcrypt")` })

// Node lookup + neighbors
execute({ code: `
  const node = pinakes.project.get("sha1-id-here");
  const neighbors = pinakes.project.neighbors(node.id, { depth: 2 });
  return { node, neighbors };
` })

// Write a wiki page
execute({ code: `
  return pinakes.project.write("decisions/use-postgres.md", "# Use PostgreSQL\\nWe chose Postgres because...");
` })

// Query across both scopes
execute({
  code: `return pinakes.project.hybrid("deploy process")`,
  scope: "both"
})
```

## CLI commands

```bash
npx @pella-labs/pinakes serve   --wiki-path <dir>     # Start the stdio MCP server
npx @pella-labs/pinakes rebuild --wiki-path <dir>     # Full rebuild from markdown
npx @pella-labs/pinakes status                        # Health check + row counts
npx @pella-labs/pinakes audit   [--tail] [--n 20]     # Tail the audit log
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
- **Two-level KG**: project wiki (`./wiki/`) + personal wiki (`~/.pinakes/wiki/`), fully isolated by default
- **Privacy invariant**: personal KG bindings are only injected when `scope` includes `'personal'`
- **Budget gate**: every response stays under `max_tokens` (default 5000, hard cap 25000)
- **Deterministic IDs**: `sha1(scope + ':' + source_uri + ':' + section_path)` means re-indexing is idempotent

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
