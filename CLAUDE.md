# KG-MCP — Project Conventions

> **Read this first.** These rules are locked from `dev-docs/presearch.md` and are not open for debate without updating that document. If you need to change something here, update the presearch first and flag the decision explicitly.

## What this is

A standalone local stdio MCP server that manages a Karpathy-style two-level knowledge wiki (project + personal) with full read/write lifecycle. Indexes markdown into SQLite and exposes it to any coding LLM via Cloudflare-style code-mode. Works with any MCP client: Claude Code, Codex, Goose, OpenCode, Cursor, or any stdio MCP host.

**Markdown is canonical. SQLite is the index.** If the index is corrupted or lost, rebuild it from the markdown source. The reverse is a bug.

## Tech Stack (LOCKED — do not change without updating presearch.md)

| Layer | Choice | Version pin |
|---|---|---|
| Language | TypeScript | 6.x strict mode, target ES2022, module nodenext |
| Runtime | Node | 24 LTS (`^24.10.0`, pinned to `24.14.1` via `.nvmrc`) |
| MCP SDK | `@modelcontextprotocol/sdk` | `^1.29.0` (v2 pre-alpha is too new) |
| Code-mode wrapper | vendored from `@cloudflare/codemode` 0.3.4 (MIT) | `src/sandbox/vendored-codemode.ts` — 4 pure-JS helpers, dep removed per presearch D30. `acorn ^8.16.0` added direct. |
| Sandbox | `quickjs-emscripten` | `^0.29.0` |
| SQLite driver | `better-sqlite3` | `^12.8.0` (Node 24 prebuild support) |
| SQLite binary | via better-sqlite3 | **3.50.4 OR 3.51.3+** — **never 3.51.0** (FTS5 regression) |
| Vector index | `sqlite-vec` | `^0.1.9` (pre-v1 — migration plan required) |
| Schema / ORM | `drizzle-orm` + `drizzle-kit` | latest |
| Markdown parsing | `micromark` + `mdast-util-from-markdown` | latest (no remark/unified) |
| Embeddings (default, bundled) | `@xenova/transformers` + `Xenova/all-MiniLM-L6-v2-quantized` | `^2.17.0` |
| Embeddings (upgrade 1, opt-in) | Ollama `nomic-embed-text` via HTTP | user-controlled |
| Embeddings (upgrade 2, opt-in) | Voyage `voyage-code-3` via HTTPS | user-controlled |
| File watch | `chokidar` | `^4.0.0` |
| Logging | `pino` | `^9.x` |
| Testing | `vitest` | `^2.x` |
| Token counter | `js-tiktoken` (`p50k_base` encoder) | `^1.0.x` |

**Do not add new dependencies without justification.** Every new dep needs a sentence in `dev-docs/presearch.md` §2.2.

## Commands

```bash
# Development
pnpm install
pnpm run build                          # tsc compile
pnpm run dev                            # tsx watch
pnpm run lint                           # eslint
pnpm run typecheck                      # tsc --noEmit

# Testing
pnpm run test                           # vitest run
pnpm run test:watch                     # vitest
pnpm run test:coverage                  # vitest with coverage
pnpm run test:privacy                   # privacy adversarial suite only (merge blocker)
pnpm run test:budget                    # budget gate adversarial suite

# Database
pnpm run db:migrate                     # apply drizzle migrations
pnpm run db:generate                    # generate new migration from schema changes

# CLI
pnpm run kg -- serve --wiki-path <dir>     # stdio MCP server (default)
pnpm run kg -- rebuild --wiki-path <dir>   # full rebuild from markdown
pnpm run kg -- status                      # health + row counts
pnpm run kg -- audit --tail                # tail kg_audit
pnpm run kg -- purge --scope <s>           # delete a scope's DB
pnpm run kg -- export --scope <s>          # dump nodes + edges as JSON
pnpm run kg -- import --scope <s> --in f   # restore from dump
```

## Architecture Rules

1. **Single process.** MCP server, chokidar, SQLite writer, read pool, embedder, and sandbox all in one Node process. No sockets, IPC, or sidecars except Ollama/Voyage HTTP when user-configured.

2. **Markdown canonical, SQLite index.** Never treat SQLite as the source of truth. Full-rebuild from markdown must always be possible and must produce identical ids (deterministic sha1 hashing).

3. **Single writer, multi reader.** One `better-sqlite3` writer connection, enforced by the app layer. Read pool of 2. **Never use a connection pool with multiple writers** — it hurts SQLite throughput (see presearch.md §Loop 0 gotcha).

4. **File layout** (target):
   ```
   src/
     server.ts                 # MCP stdio server entry
     spike.ts                  # Phase 1 spike entry (remove after Phase 2)
     cli/                      # CLI subcommands
     mcp/                      # MCP tool definitions + dispatcher
       tools/search.ts
       tools/execute.ts
       dispatcher.ts           # scope enforcement + audit
     sandbox/                  # QuickJS + code-mode executor
       executor.ts             # QuickJSExecutor (Phase 1+) — fresh-context-per-call; warm pool in Phase 3
       vendored-codemode.ts    # vendored normalizeCode + sanitizeToolName + generateTypesFromJsonSchema + Executor interface (MIT, Cloudflare Inc.) — presearch D30
       bindings/               # kg, budget, logger bindings (Phase 3+)
       pool.ts                 # warm pool N=2 (Phase 3)
     db/
       schema.ts               # drizzle schema (ALL 8 tables)
       client.ts               # connection management
       migrations/
     ingest/
       source.ts               # IngestSource interface
       chokidar.ts             # ChokidarWatcher implementation
       queue.ts                # QueueSubscriber (stub until contract lands)
       ingester.ts             # single-flight writer
       parse/
         markdown.ts
         chunk.ts
     retrieval/
       fts.ts                  # FTS5 with bm25 + snippet
       vec.ts                  # sqlite-vec
       hybrid.ts               # RRF CTE
       embedder.ts             # factory (transformers | ollama | voyage)
     gate/
       budget.ts               # token counting + truncation
     gaps/
       detector.ts             # concept gap detection
     observability/
       logger.ts               # pino config
       metrics.ts              # in-process counters
       audit.ts                # kg_audit writer + jsonl mirror
     __tests__/
       privacy/                # 15-test adversarial suite
       budget/                 # budget gate adversarial suite
       ...
   dev-docs/
     presearch.md              # architecture decisions (source of truth)
     PRD.md                    # phased build plan
     research-brief.md         # Loop 0 findings
     prior-art.md              # notes from reading obra/knowledge-graph, qmd, etc.
   ```

5. **Module boundaries**: `mcp/` knows about tool schemas. `sandbox/` knows about QuickJS. `db/` knows about SQL. `retrieval/` knows about queries. **No cross-module imports except through explicit interfaces** (e.g. `ingest/` → `db/` is OK via a writer-facing repository interface).

6. **Write path via sandbox bindings.** The LLM writes wiki content via `kg.project.write(path, content)` inside `kg_execute`. Writes go to disk first (atomic rename), then chokidar triggers re-indexing. Markdown remains canonical. Safety constraints: path containment to wiki root, `.md` extension only, 100KB max per write, 20 writes per `kg_execute` call, audit-logged. See presearch.md D35.

7. **Client-agnostic MCP surface**: any stdio MCP client can use this server. Do not add client-specific coupling (Electron IPC, Goose-specific channels, etc.). The stdio protocol is the only integration surface.

## Database Rules

1. **Pragmas on every connection, non-negotiable**:
   ```sql
   PRAGMA journal_mode = WAL;
   PRAGMA busy_timeout = 5000;
   PRAGMA synchronous = NORMAL;
   PRAGMA foreign_keys = ON;
   PRAGMA cache_size = -20000;
   PRAGMA temp_store = MEMORY;
   ```

2. **Deterministic node ids**: `id = sha1(scope + ':' + source_uri + ':' + section_path)`. Re-indexing the same content must produce the same id. This makes ingest idempotent.

3. **Per-chunk content hash + skip-unchanged**: every `kg_chunks` row carries `chunk_sha = sha1(chunk_text)`. On re-ingest of a whole file (callers commonly rewrite full files, not diffs), only re-embed chunks whose `chunk_sha` changed. This avoids the cascading reindex bomb where 6 wiki files rewritten per turn trigger 60 chunks × 50ms embedding = 3s of blocking work that competes with the active coding LLM for Ollama.

4. **Chokidar debounce: 2 seconds**, not default 50ms. Writes use atomic rename which triggers chokidar, but follow-up writes (e.g., log.md append) land microseconds later. A 2s debounce coalesces them into one ingest pass. Use a bounded queue with drop-oldest if multiple ingest events for the same file are queued.

5. **Startup consistency check** via `.kg/kg-manifest.json` (project) and `~/.kg/kg-manifest.json` (personal). The manifest stores `{ file_path: {source_sha, chunk_shas: []} }`. On startup, compare to disk and auto-rebuild divergent files. This handles mid-ingest crash recovery against pre-v1 sqlite-vec's untested crash semantics.

6. **Staleness check**: on query, compare current disk `source_sha` to DB `source_sha`; emit mismatches in `meta.stale_files[]`.

7. **Transactions per ingest**: wrap each file's ingest in `BEGIN ... COMMIT`. Partial failures rollback cleanly.

8. **Schema versioning**: stamp a `schema_version` row in `kg_meta`. On mismatch at startup, run migrations; if sqlite-vec breaks, drop + rebuild `kg_chunks_vec` and re-embed (fast, ~10s for 5K chunks).

9. **FTS5 tokenizer**: use `unicode61 remove_diacritics 2`. **NOT trigram** — it triples the DB size (see presearch.md §Loop 0 gotcha).

10. **Vector dims**: currently 384 (MiniLM default). If user swaps embedder, `kg_chunks_vec` must be dropped and recreated with new dims, then all chunks re-embedded. Do this as a distinct migration path.

11. **Standalone DB files**: `<projectDir>/.kg/kg.db` for project KG, `~/.kg/kg.db` for personal KG. No shared schema with any external app. The `--db-path` flag overrides the default for backward compatibility with existing deployments.

12. **Personal KG hard cap: 5,000 chunks with LRU eviction** on `last_accessed_at`. Personal KG accumulates across every repo the developer touches; without a cap it grows unbounded and bloats vector search latency (200ms+ per query at 50K chunks). Every row in `kg_nodes` and `kg_chunks` for `scope='personal'` has a `last_accessed_at` timestamp bumped on every read. On ingest, if the personal KG exceeds 5000 chunks, evict the oldest-accessed nodes (cascades to chunks/edges) until under the cap. The project KG has no cap (scoped to the repo, dies with the repo).

## API Rules (MCP tool surface)

1. **Exactly 2 tools. No exceptions in MVP.** `kg_search` and `kg_execute`. Adding a third breaks the code-mode thesis (minimize tool schema tokens).

2. **Total tool schema footprint target <1500 tokens.** Measure via js-tiktoken in CI. Fail the build if the concatenated tool descriptions exceed 1500 tokens.

3. **`scope` param is required on every tool call.** Defaults to `'project'`. Enum: `'project' | 'personal' | 'both'`.

4. **`max_tokens` param defaults to 5000, max 20000.** Enforced at the dispatcher, not the sandbox.

5. **Response envelope is immutable** — every response MUST have:
   ```typescript
   { result, meta: { tokens_budgeted, tokens_used, results_truncated, scope, query_time_ms, stale_files }, logs? }
   ```
   If you add a field, update the envelope type in `src/mcp/envelope.ts` and regenerate any tool schemas that embed it.

6. **Never emit a response >25000 tokens.** The server-side budget gate is the last line of defense. Budget math:
   - `envelope_reserve = 500` tokens (for `meta`, `logs`, `stale_files`, etc.)
   - `safety_margin = 0.9` (js-tiktoken estimation error headroom)
   - `available_for_results = floor((max_tokens - envelope_reserve) * safety_margin)`
   - At user `max_tokens=5000`: `available = floor(4500 * 0.9) = 4050` tokens for actual result bodies
   - Truncation is **greedy by RRF rank**: keep the highest-ranked result whole if it fits; otherwise emit a **`too_large` sentinel** with an id + URI so the LLM can decide to re-query with higher `max_tokens` or `kg.project.get(id)` for the specific node
   - **Long-string fast path**: `countTokens(text)` in `src/gate/budget.ts` switches to a conservative character-based estimate (`ceil(length / 3.0)`) when `text.length > EXACT_TOKENIZE_MAX_CHARS` (currently 8000). This mitigates a js-tiktoken O(n²) DoS vector found in Phase 1 — a 60K-char string takes ~200s to tokenize otherwise. Any replacement tokenizer must either be O(n) or preserve this threshold. See presearch.md D32.
   - Test adversarially: single 10K-token node, 100 small nodes, 1 huge + 99 small, all must comply

7. **Tool descriptions are the prompt.** Keep them clear and terse. Describe when to use `kg_search` vs `kg_execute`. Describe scope semantics. Describe that `eval`/`Function`/`fetch` are unavailable in the sandbox.

8. **Errors go in the result, not as MCP protocol errors.** Claude Code has a bug where `isError: true` displays as `Error: undefined` (see presearch.md §Loop 0). Put actionable error info in the normal result payload under `result.error`.

## Security Rules

1. **Privacy invariant (non-negotiable)**: the `kg.personal` binding is injected into the sandbox environment ONLY when the tool call's `scope` param includes `'personal'`. This is enforced at the tool dispatcher, not inside the sandbox. The 15-test adversarial suite is a merge blocker — any test failure blocks the merge.

2. **Sandbox globals: disable these at QuickJS runtime setup**:
   - `eval`
   - `Function`
   - `import` (dynamic)
   - `fetch`
   - `require`
   - `process`
   - `globalThis.constructor`
   - Anything else that could reach the host

3. **Sandbox resource caps**:
   - Memory: `runtime.setMemoryLimit(64 * 1024 * 1024)` — 64MB hard cap (WASM-enforced)
   - CPU: `shouldInterruptAfterDeadline` with `timeout_ms` param (default 2000, max 10000)

4. **Ingested text is untrusted data, never code.** The sandbox never evaluates content from the KG. Any string from `kg.project.fts()` etc. is just a string.

5. **API keys**: read from env at startup (`KG_VOYAGE_API_KEY`, `KG_OPENAI_API_KEY`, `KG_OLLAMA_URL`). **Never log them.** Never write them to disk from our code.

6. **Cross-scope tagging**: every result object returned from a `scope='both'` call MUST include `source_scope: 'project' | 'personal'`. The LLM is responsible for respecting it — our job is to surface it, not to enforce what the LLM does with it. (This is the user's explicit tradeoff: LLM-driven bridge is a feature, not a bug. Document it in the tool description.)

7. **Audit log — SPLIT BY SCOPE (non-negotiable)**: every tool call appends a row to `kg_audit` with `ts`, `tool_name`, `scope_requested`, `caller_ctx`, `response_tokens`, `error`. **The JSONL mirror path depends on scope**:
   - `scope='project'` → `.kg/audit.jsonl` (in the user's repo; safe for `git add .`)
   - `scope='personal'` OR `scope='both'` → `~/.kg/audit.jsonl` (in `$HOME`, never in a repo)
   - **Never** write personal query text or snippets to a path inside the project repo. Doing so creates a leak via `git add .`.
   - The SQLite `kg_audit` table in `.kg/kg.db` is also project-scoped — any personal-scope audit row goes to a separate `kg_audit` table in `~/.kg/kg.db`, not the project DB.

8. **Vendoring fallback for `@cloudflare/codemode`**: we only use 4 exports (`generateTypesFromJsonSchema`, `normalizeCode`, `sanitizeToolName`, `ToolDispatcher`). If Cloudflare abandons the package or ships an incompatible breaking change, copy the relevant functions into our repo and pin. Total size <400 LOC.

## AI Rules

1. **We don't call LLMs on the query path by default.** The calling LLM is the client's concern. The exception is the opt-in `expand` param on `kg_search` (D38) which uses the LLM provider factory (D36) for multi-query expansion — non-fatal, falls back to the original query if no provider is available. The contradiction detector (Phase 8 H) also uses the LLM provider but is a background CLI command, not a query-path call.

2. **Gap-detection sub-agent is rate-limited**: max 1 call per hour background, or explicit user command. Never per query.

3. **Embedder choice is env-driven**:
   ```
   KG_EMBED_PROVIDER=transformers  # default (bundled)
   KG_EMBED_PROVIDER=ollama        # requires KG_OLLAMA_URL + KG_OLLAMA_MODEL
   KG_EMBED_PROVIDER=voyage        # requires KG_VOYAGE_API_KEY
   KG_EMBED_PROVIDER=openai        # requires KG_OPENAI_API_KEY
   ```

4. **Embedder failure is non-fatal**: if the configured embedder fails during ingest, log a warning, insert the node+chunks without vec rows, continue. Query-time degrades gracefully to FTS5-only for affected chunks.

5. **Per-KG embedder opt-in**: embedding the personal KG with a paid API requires **explicit** per-KG config, not a global switch. Default posture: personal KG uses bundled transformers.js regardless of project setting.

## Testing Rules

1. **Vitest, co-located tests under `src/**/__tests__/`.**

2. **Minimum counts per phase** (from PRD.md):
   - Schema/DB: 15
   - Ingestion: 15
   - MCP tool surface: 10
   - Sandbox (includes 15 privacy adversarial + 6 disabled-global): 20+
   - Hybrid retrieval + budget: 10
   - Integration e2e: 10
   - **Total ≥80 before MVP ship**

3. **Merge blockers** (must all pass):
   - Full test suite green
   - Privacy adversarial suite 15/15
   - Budget adversarial suite 5/5 (queries that would return 100K tokens of text, all truncated to ≤max_tokens)
   - `npm audit` clean
   - Tool schema footprint ≤1500 tokens (CI check)

4. **Ground truth**: hand-labeled query/result pairs against fixture repos live in `src/__tests__/fixtures/ground-truth.json`. Phase 4 gates on ≥70% hit rate.

5. **No mocking SQLite**: tests use a real in-memory SQLite database. Integration tests use a real fixture wiki directory.

6. **Sandbox tests must use a real QuickJS instance**, not a mock. QuickJS boundary behavior is what we're testing.

7. **TDD is not mandatory** but the merge blockers don't care whether you red-green-refactored — they just need the tests green.

## Key Constraints

- **Hard 25,000-token cap on every MCP tool response** (Claude Code enforcement). Budget gate uses 90% of user's max_tokens as internal budget (js-tiktoken error margin). Tested adversarially.
- **Markdown is canonical.** Rebuilding the SQLite index from scratch must always work.
- **Single process, single writer.** Don't add sidecars or connection pools with multiple writers.
- **Two tools only.** Any proposal to add a third tool must update presearch.md first.
- **Privacy invariant is the highest-priority invariant.** A leak is worse than downtime.
- **Client-agnostic.** Works with any MCP client (Claude Code, Codex, Goose, OpenCode, Cursor). Do not add client-specific code paths.
- **sqlite-vec is pre-v1**; pin exact version and have a migration plan.
- **FTS5 3.51.0 has a regression**; never use that exact SQLite version.

## Environment Variables

```bash
# Paths
KG_WIKI_PATH=/path/to/project/.kg/wiki         # required in serve mode; default .kg/wiki
KG_PROFILE_PATH=~/.kg                          # optional; default ~/.kg

# Embedder selection
KG_EMBED_PROVIDER=transformers                 # transformers | ollama | voyage | openai
KG_EMBED_MODEL=Xenova/all-MiniLM-L6-v2-quantized  # provider-specific

# Ollama config (if KG_EMBED_PROVIDER=ollama)
KG_OLLAMA_URL=http://localhost:11434
KG_OLLAMA_MODEL=nomic-embed-text

# API keys (if configured)
KG_VOYAGE_API_KEY=
KG_OPENAI_API_KEY=

# Runtime tuning
KG_MAX_MEMORY_MB=64                            # QuickJS memory cap
KG_MAX_TIMEOUT_MS=10000                        # QuickJS hard timeout ceiling
KG_WARM_POOL_SIZE=2                            # concurrent sandbox isolates
KG_LOG_LEVEL=info                              # pino level

# Write path
KG_MAX_WRITE_SIZE=102400                       # max bytes per wiki write (100KB default)

# Observability
KG_AUDIT_JSONL_PATH=.kg/audit.jsonl            # mirror location
```

**Never commit any env with secret values.** Use `.env.example` for placeholders, `.env` is gitignored.

## Reference Documents

- `dev-docs/presearch.md` — architecture decisions (source of truth for this file)
- `dev-docs/PRD.md` — phased build plan
- `dev-docs/research-brief.md` — Loop 0 web research (sourced findings with URLs)
- `dev-docs/prior-art.md` — notes from reading obra/knowledge-graph, tobi/qmd, basic-memory, jx-codes/codemode-mcp
- [blog.cloudflare.com/code-mode-mcp](https://blog.cloudflare.com/code-mode-mcp/) — the canonical code-mode writeup
- [gist.github.com/karpathy/442a6bf555914893e9891c11519de94f](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) — the Karpathy LLM-Wiki spec

## Changing locked decisions

If you need to change anything in this file:
1. Update `dev-docs/presearch.md` first with the new decision and rationale
2. Add an entry to presearch.md §Decision log with a new `Dn` number
3. Update this file to match
4. Update `PRD.md` if the change affects phases or acceptance criteria
5. Commit all four files in the same change
