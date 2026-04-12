# Pinakes — Product Requirements Document

> **Project**: standalone code-mode MCP server managing a two-level Karpathy knowledge wiki with full read/write lifecycle, compatible with any MCP client (Claude Code, Codex, Goose, OpenCode, Cursor).
>
> **This document is the phased build plan.** Architecture decisions live in `presearch.md`. Project conventions live in `CLAUDE.md`. Loop 0 findings live in `research-brief.md`.
>
> **Date**: 2026-04-08

## POC goal (one sentence)

A coding LLM can call `search("auth flow")`, query via `execute("return pinakes.project.hybrid('bcrypt').filter(r => r.confidence === 'extracted').slice(0, 5)")`, and write knowledge via `execute("pinakes.project.write('auth-decisions', '# Auth Decisions\n...')")` against a real wiki, with budget-shaped, privacy-respecting answers in <500ms p95, inside the 25K-token cap, without any external network dependency.

## Foundation — locked from presearch.md

- **Tech stack locked**: TypeScript 6, Node 24 LTS, `@modelcontextprotocol/typescript-sdk ^1.29.0`, `@cloudflare/codemode`, `quickjs-emscripten ^0.29.0`, `better-sqlite3 ^11.3.0` against SQLite 3.50.4 or 3.51.3+, `sqlite-vec ^0.1.9`, `drizzle-kit + drizzle-orm`, `@xenova/transformers ^2.17.0`, `chokidar ^4`, `pino ^9`, `vitest ^2`, `js-tiktoken`.
- **Two MCP tools total**: `search` (fast path) + `execute` (code-mode). Target schema footprint <1500 tokens.
- **Markdown canonical, SQLite is the index.**
- **Sandbox = QuickJS with hard 64MB memory cap + 2s default timeout**, `eval`/`Function`/`fetch`/`require`/`process`/`import` disabled.
- **Privacy invariant**: `pinakes.personal` binding injected into the sandbox ONLY when the tool call's `scope` param includes `'personal'`. Refused at the dispatcher, audited.
- **Budget gate**: server-side final gate with 10% safety margin on `js-tiktoken` token count. Never emit a response >25K tokens.

---

## Phase breakdown

### Phase 0 — Scaffold + prior art study ✅ COMPLETE

**Goal**: set up the repo, pin dependencies, and read prior art before writing any of our own code.

**Depends on**: nothing.

**Effort**: ½ day.

#### Requirements
- [x] Initialize `pinakes` npm package at `~/dev/gauntlet/knowledge-graph/`
- [x] Install and lock all dependencies from the locked tech stack (`package-lock.json` committed)
- [x] `tsconfig.json` strict mode, target ES2022, module nodenext
- [x] `vitest.config.ts` with coverage reporter
- [x] `pino` logger config — stderr output, pretty in dev
- [x] `.env.example` with `PINAKES_VOYAGE_API_KEY`, `PINAKES_OPENAI_API_KEY`, `PINAKES_EMBED_PROVIDER`, `PINAKES_WIKI_PATH`, `PINAKES_PROFILE_PATH` placeholders
- [x] **Clone and skim prior art** (do not fork any of them; take patterns only):
  - [x] `jx-codes/codemode-mcp` — OSS code-mode for local MCP
  - [x] `obra/knowledge-graph` — closest architectural match
  - [x] `tobi/qmd` — Karpathy-blessed BM25+vector+LLM-rerank pattern
  - [x] `basicmachines-co/basic-memory` — the 3-workflow pattern in Python
- [x] Read `@cloudflare/codemode` source from `node_modules` directly — understand the `Executor` interface firsthand
- [x] Verify `@modelcontextprotocol/typescript-sdk ^1.29.0` is the right version for current Claude Code + Goose
- [x] Write `dev-docs/prior-art.md` — 1 page per project, "what we're taking from each"

#### Innovations included
None (setup phase).

#### Tests
None required.

#### Acceptance criteria
1. `npm run build` clean compile
2. `npm run test` runs successfully (zero tests OK)
3. `dev-docs/prior-art.md` exists and is substantive
4. `package-lock.json` committed with every dependency from the locked stack pinned exactly

#### Key decisions referenced
- presearch.md §2.2 (tech stack)

---

### Phase 1 — Feasibility spike ✅ COMPLETE (2026-04-08)

**Goal**: prove the 3 critical unknowns in a single focused session.
- **U1**: QuickJS code-mode sandbox runs LLM-like JS against local data at acceptable latency — **PROVEN** (p50 cold-start 0.38ms, p95 0.68ms)
- **U2**: Response budget-shaping stays under the 25K-token cap on realistic data — **PROVEN** (adversarial 15-object + 60K-char-string cases both truncated correctly)
- **U3**: Markdown-as-canonical + in-process pipeline round-trips end-to-end through MCP stdio — **PROVEN** (full JSON-RPC handshake + search/execute calls via a direct stdin/stdout harness against `dist/spike.js`)

**Depends on**: Phase 0.

**Effort**: ½-1 day (actual: ~1 day wall-clock, single session).

#### Requirements
- [x] `src/spike.ts` stdio MCP server via `@modelcontextprotocol/sdk` (package name corrected per D29; uses the high-level `McpServer.registerTool` API per D34, not `Server.setRequestHandler`)
- [x] **Both** `search` and `execute` tools registered
- [x] In-memory document store loaded from `--wiki-path` → `src/ingest/memory-store.ts`:
  - [x] Reads every `*.md` recursively via `fs.readdir({ recursive: true })`
  - [x] Splits each file on blank lines (`\r?\n\r?\n+`)
  - [x] Stores as `{ id: sha1(rel_path + ':' + chunk_idx), text, source_uri, chunk_index }[]`
- [x] Trivial substring-based FTS: case-insensitive `.toLowerCase().includes(...)` filter
- [x] Custom `QuickJSExecutor` (`src/sandbox/executor.ts`) implementing the Executor interface from `src/sandbox/vendored-codemode.ts`. Fresh context per call, 64MB memory cap, deadline-based interrupt. **Uses sync `context.getPromiseState(...)` not `context.resolvePromise(...)` per D31.**
- [x] Sandbox env exposes the minimal `pinakes` global as specified
- [x] Response budget gate: `src/gate/budget.ts` — `envelope_reserve=500`, `safety_margin=0.9`, `internal_budget = floor((max_tokens - 500) * 0.9) = 4050` at the default 5000. **Includes a length-threshold fast path (`EXACT_TOKENIZE_MAX_CHARS = 8000`) to mitigate the js-tiktoken O(n²) DoS vector per D32.**
- [x] Response envelope: `{ result, meta: { tokens_budgeted, tokens_used, results_truncated, scope, query_time_ms, stale_files }, logs? }` — full CLAUDE.md §API Rules #5 shape, not just the 4 fields in the original spec (`scope`, `stale_files`, `logs` threaded through for Phase 5 forward-compat)
- [x] Disabled globals inside sandbox: `eval`, `Function`, `fetch`, `require`, `process`, `WebAssembly`, and a throwing getter on `constructor`. (`import()` is absent from QuickJS contexts by default — no bootstrap needed.)
- [x] SIGTERM and SIGINT handlers for clean exit

#### Innovations included
- **A** (code-mode native KG API) — minimal form
- **B** (budget-shaped response primitive) — minimal form

#### Tests — 13/13 passing in 2.48s wall clock
Located in `src/__tests__/spike.test.ts`, using a real `MemoryStore` loaded from `src/__tests__/fixtures/wiki/{auth,database,log}.md` and a real `QuickJSExecutor` (no mocks).

Five required by the original PRD plus eight bonus tests that land for free once the infrastructure exists:

- [x] `search("hashPassword")` returns ≥1 result on fixture markdown
- [x] `search("bcrypt")` returns ≥1 result with the expected chunk shape
- [x] `search("zzzz...")` returns `[]` with `results_truncated: false` (error-free empty case)
- [x] `execute("return pinakes.search('x').length")` returns the correct count
- [x] `execute` binding sanity: `pinakes.search('bcrypt').slice(0,3).map(h => h.id)` returns ≤3 stable sha1 ids
- [x] Budget truncation: `execute("return Array(1000).fill('blah blah blah')")` → `results_truncated: true` AND `tokens_used ≤ 5000`
- [x] Sandbox timeout: `execute("while(true){}")` → in-payload `error`, wall-clock within 2000ms + slack
- [x] Disabled global: `execute("return eval('1+1')")` → in-payload `error` mentioning eval
- [x] `logger.log('hello', { n: 42 })` captured into `envelope.logs[]`
- [x] **PRD criterion #9 cold-start benchmark** — 20 fresh contexts × `return 1+1`, p50 **0.38ms** (gate was 150ms)
- [x] **PRD criterion #10 budget math sanity** — 15 medium objects @ max_tokens=5000, `meta.tokens_used` within 10% of measured envelope size
- [x] **PRD criterion #10 (oversize scalar case)** — `'x'.repeat(60000)` at max_tokens=5000 → `results_truncated: true` + `error` field, completes in milliseconds thanks to the D32 long-string fast path
- [x] **Tool schema footprint (CLAUDE.md §API Rules #2)** — both tools combined serialize to **414 tokens** against the 1500 budget

#### Acceptance criteria (the feasibility call) — 10/10 required passing

Note: the original criterion #1 referenced `~/dev/gauntlet/pharos/desktop/evals/snapshots/wiki-turns`, but that path is only populated when Pharos eval-14 runs. Phase 1 substitutes a checked-in minimal fixture at `src/__tests__/fixtures/wiki/` so the spike is self-contained and deterministic. The criterion is semantically satisfied: "spike accepts `--wiki-path` and starts against it".

1. ✅ `node dist/spike.js --wiki-path src/__tests__/fixtures/wiki` starts the stdio server (tsx path also works; we build first and use the compiled entry)
2. ✅ `claude mcp add pinakes-spike -- node /abs/path/to/dist/spike.js --wiki-path /abs/path/to/fixtures/wiki` registers cleanly
3. ✅ `claude mcp list` shows `pinakes-spike: ✓ Connected`
4. ✅ Direct JSON-RPC handshake via stdin/stdout: `search("hashPassword")` → 4 results, **602 tokens used** (well under 5000), query_time_ms 3
5. ✅ `execute("return pinakes.search('bcrypt').map(h => h.id).slice(0, 3)")` → 2 sha1 chunk ids (the fixture has exactly 2 chunks mentioning bcrypt), 93 tokens, 10ms
6. ✅ Envelope has `tokens_used` AND `query_time_ms` AND the full CLAUDE.md §API Rules #5 shape (scope, stale_files, results_truncated)
7. ✅ Cold-start `execute` p50 **0.38ms**, p95 **0.68ms** — ~1000x under the 500ms / 1500ms budget
8. ✅ Server exits clean on SIGTERM: pino log line then `process.exit(0)` within milliseconds
9. ✅ **Sandbox cold-start benchmark gate (D24)** — p50 **0.38ms** over 20 runs with fresh QuickJS runtime+context each iteration. **PASSED DECISIVELY; QuickJS locked per D33; `isolated-vm` fallback dropped from the plan.**
10. ✅ **Budget math sanity check** — 15 medium objects @ max_tokens=5000: `meta.tokens_used` within 10% of measured envelope size, `results_truncated: false` (budget holds). Also verified the oversize-scalar case (`'x'.repeat(60000)`) returns an in-payload error in milliseconds instead of blocking the event loop — led directly to D32 (js-tiktoken long-string fast path).
11. ⏸ **Optional** — Goose native MCP extension registration deferred. Not a Phase 1 blocker; will land when Pharos integration work begins.

#### Go/no-go decision: **GO** — proceed to Phase 2

All 10 required criteria passed. Criterion #11 is explicitly optional. Phase 2 (SQLite + chokidar ingestion) can start immediately. No presearch reversals or PRD amendments needed beyond the D31-D34 decision log additions.

#### Key decisions referenced
- presearch.md §2.5 (tool surface)
- presearch.md §2.7 (embedder deferred to Phase 4)

---

### Phase 2 — Persistence + ingestion ✅ COMPLETE (2026-04-09)

**Goal**: replace the in-memory array with the real SQLite schema + chokidar ingestion.

**Depends on**: Phase 1 passes.

**Effort**: 1-2 days (actual: ~1 day).

#### Requirements
- [x] Drizzle schema for all 8 tables (`pinakes_nodes`, `pinakes_edges`, `pinakes_chunks`, `pinakes_chunks_fts`, `pinakes_chunks_vec`, `pinakes_log`, `pinakes_gaps`, `pinakes_audit`) per presearch.md §2.3 + `pinakes_meta` table for schema version
- [x] `pinakes_nodes` includes `last_accessed_at INTEGER NOT NULL` (for Phase 5 personal KG LRU per Loop 6.5 A2)
- [x] `pinakes_chunks` includes `chunk_sha TEXT NOT NULL` (per Loop 6.5 A4 — enables per-chunk skip-unchanged)
- [x] Drizzle-kit migration setup
- [x] Non-negotiable pragmas on every connection: `journal_mode=WAL`, `busy_timeout=5000`, `synchronous=NORMAL`, `foreign_keys=ON`, `cache_size=-20000`, `temp_store=MEMORY`
- [x] Single writer connection enforced at app layer
- [x] Read pool of 2 connections
- [x] `src/parse/markdown.ts` using `micromark` + `mdast-util-from-markdown`
- [x] `src/parse/chunk.ts` — split nodes into ~500-token chunks on paragraph boundaries; deterministic output (pinned micromark version)
- [x] `src/ingest/source.ts` — `IngestSource` interface per presearch.md §2.5
- [x] `src/ingest/chokidar.ts` — `ChokidarWatcher implements IngestSource`
  - **2-second debounce** (not default 50ms) per Loop 6.5 A4
  - **Bounded queue with drop-oldest** per `source_uri`: if multiple rewrites arrive before ingest runs, keep only the latest
- [x] `src/ingest/ingester.ts` — single-flight per `source_uri` via `Map<path, Promise>`
  - **Per-chunk skip-unchanged**: compute `chunk_sha` for each chunk; compare to DB; only re-embed if changed. This is the critical optimization for the whole-file-rewrite-per-turn pattern (both the write binding and external editors rewrite full files).
- [x] Idempotent upsert on `id = sha1(scope + source_uri + section_path)`
- [x] Transaction-per-file ingest: `BEGIN` → `DELETE old chunks WHERE node_id IN (...)` → inserts → `COMMIT` (rollback on error)
- [x] `source_sha` on every chunk row for staleness detection
- [x] **Consistency manifest** per Loop 6.5 A6:
  - `src/ingest/manifest.ts` writes `.pinakes/manifest.json` (project) or `~/.pinakes/manifest.json` (personal) at the end of every successful transaction
  - Format: `{ files: { <file_path>: { source_sha, chunk_shas: string[] } } }`
  - Startup consistency check: for each file in the manifest, compute current `source_sha`; enqueue rebuild for mismatches (covers pre-v1 sqlite-vec crash recovery gaps)
- [x] Every ingest event appends to `pinakes_log`
- [x] `src/cli/rebuild.ts` — `pinakes rebuild --path <dir>` full-rebuild-from-markdown CLI

#### Innovations included
None new (foundation for later phases).

#### Tests (minimum 18 — bumped from 15 for Loop 6.5 patches)
- [x] Schema migration up
- [x] Schema migration down
- [x] Every pragma applied on a fresh connection
- [x] Node insert idempotent (write twice → 1 row)
- [x] FK cascade: delete node → chunks + edges gone
- [x] Chunker deterministic on fixture markdown (same input → same ids AND same chunk_shas)
- [x] File → nodes → chunks round-trip preserves content
- [x] FTS5 virtual table populates on chunk insert
- [x] sqlite-vec virtual table accepts an insert with a 384-dim float32 array
- [x] Staleness detection: modify file, query → mismatched sha reported
- [x] Chokidar event → ingest → row count increases
- [x] Chokidar 2-second debounce: 10 rapid events for the same file → 1 ingest
- [x] Chokidar bounded queue drop-oldest: 3 different content versions queued → only latest ingests
- [x] Single-flight: fire 3 events for same file in parallel → 1 ingest
- [x] **Per-chunk skip-unchanged**: simulate whole-file rewrite pattern — rewrite a file with 10 chunks, change 1 paragraph → exactly 1 chunk re-embedded (measured via embedder call counter)
- [x] Transaction rollback on mid-ingest error leaves DB clean
- [x] `rebuild` CLI produces identical row count to chokidar path
- [x] **Manifest consistency check**: write manifest, mutate a chunk_sha in DB to be wrong, restart → affected file enqueued for rebuild
- [x] Ingest event appended to `pinakes_log`

#### Acceptance criteria
1. Running against `~/dev/gauntlet/pharos/desktop/evals/snapshots/wiki-turns` populates all 8 tables
2. `search` now queries SQLite, not the in-memory array
3. Chokidar event fires → row count updates within 200ms
4. `SELECT COUNT(*) FROM pinakes_nodes` matches expected fixture count
5. `pinakes rebuild` completes in <10s on fixture data

#### Key decisions referenced
- presearch.md §2.3 (schema)
- presearch.md §2.5 (IngestSource adapter)

---

### Phase 3 — Sandbox + code-mode bindings (full) ✅ COMPLETE (2026-04-09)

**Goal**: promote the spike's minimal sandbox into the full code-mode environment from presearch.md §2.5.

**Depends on**: Phase 2.

**Effort**: 2 days (actual: <1 day).

#### Requirements
- [x] Full `pinakes.project` binding surface:
  - [x] `fts(query, opts)` — FTS5 MATCH with bm25 ranking
  - [x] `vec(query, opts)` — stub that returns `[]` until Phase 4
  - [x] `hybrid(query, opts)` — stub that returns `[]` until Phase 4
  - [x] `get(id)` — row lookup by node id
  - [x] `neighbors(id, opts)` — recursive CTE k-hop traversal on `pinakes_edges`
  - [x] `log.recent(n, opts)` — time-ordered `pinakes_log` reads
  - [x] `gaps(opts)` — stub that returns `[]` until Phase 6
- [x] `budget` helper with working `fit<T>()` implementation using `js-tiktoken`
- [x] `logger.log()` captured into `ExecuteResult.logs`
- [x] **Disabled globals verified**: `eval`, `Function`, `import`, `fetch`, `require`, `process`, `globalThis.constructor` — each has an adversarial test
- [x] **Warm pool N=2** isolates + semaphore (bumped from N=1 per Loop 6 patch P3)
- [x] Overflow spawns cold isolate; never blocks indefinitely
- [x] Isolate crash → dispose → respawn → structured error (never propagates to MCP protocol layer) — Loop 6 patch P4
- [x] Timeout via `shouldInterruptAfterDeadline` (default 2s, max 10s, from `timeout_ms` param)
- [x] Memory limit via `runtime.setMemoryLimit(64 * 1024 * 1024)` — 64MB WASM-enforced
- [x] `normalizeCode` from `@cloudflare/codemode` applied before execution (acorn AST sanitize)
- [x] TypeScript declarations for `pinakes` API emitted inline in the `execute` tool description so the LLM knows what's available without a separate schema fetch

#### Innovations included
- **A** (code-mode native KG API, full)

#### Tests (minimum 20)
- [x] 15 privacy adversarial tests (attempts to read `pinakes.personal` from project-only context, all must fail — shipped in Phase 5, 15/15 pass)
- [x] eval() denied
- [x] Function() denied
- [x] import() denied
- [x] fetch() denied
- [x] require() denied
- [x] process access denied
- [x] Timeout: `while(true){}` killed within 2s
- [x] Memory cap: allocate 100MB → throws inside sandbox
- [x] Warm pool reuse: 2 sequential `execute` calls hit the same isolate (track via instrumentation)
- [x] Overflow cold spawn: 3 concurrent calls — 2 warm + 1 cold
- [x] Crash recovery: deliberately crash isolate, next call still works
- [x] Complex snippet: chain `pinakes.project.fts('auth').filter(...).slice(...)` → valid result
- [x] `logger.log()` captured in response
- [x] `budget.fit()` truncates a 100-item array to fit under 5K tokens

#### Acceptance criteria
1. All 20+ tests pass
2. `execute` p95 latency <200ms on warm pool with Phase 2's fixture data
3. 15-test adversarial privacy suite 15/15 (stub-tested here; real enforcement in Phase 5)
4. No isolate crash takes down the MCP server process

#### Key decisions referenced
- presearch.md §2.5 (sandbox env)
- presearch.md §2.10 (verification design)
- presearch.md §3.1 F11/F12 (timeout + memory limit)

---

### Phase 4 — Hybrid retrieval + budget gate ✅ COMPLETE (2026-04-09)

**Goal**: real FTS5 + sqlite-vec + RRF in the sandbox bindings, and a rock-solid server-side budget gate.

**Depends on**: Phase 3.

**Effort**: 2 days (actual: <1 day).

#### Requirements
- [x] FTS5 query implementation: `MATCH` + `bm25(pinakes_chunks_fts)` + `snippet()` for bounded context
- [x] Vector query implementation: `vec_distance_cosine()` against `pinakes_chunks_vec` with `k = limit`
- [x] **Hybrid RRF** (Alex Garcia's canonical pattern, `rrf_k = 60` default) — implemented as app-level fusion in `src/retrieval/hybrid.ts` rather than a single SQL CTE, because the vec query requires an async embedding step:
  ```sql
  WITH vec_matches AS (
    SELECT chunk_id, row_number() OVER (ORDER BY distance) AS rn
    FROM pinakes_chunks_vec WHERE embedding MATCH :qvec AND k = :limit
  ),
  fts_matches AS (
    SELECT rowid, row_number() OVER (ORDER BY rank) AS rn
    FROM pinakes_chunks_fts WHERE chunk_text MATCH :qtext
  )
  -- FULL OUTER JOIN on id, RRF score
  ```
- [x] Embedder factory with three backends:
  - [x] **Default**: `@xenova/transformers` + `Xenova/all-MiniLM-L6-v2-quantized` (bundled; ~22MB, 384-dim)
  - [x] **Upgrade 1**: Ollama HTTP (read `PINAKES_EMBED_PROVIDER=ollama` + `PINAKES_OLLAMA_MODEL=nomic-embed-text`)
  - [x] **Upgrade 2**: Voyage HTTPS (read `PINAKES_VOYAGE_API_KEY` + `PINAKES_EMBED_PROVIDER=voyage`)
- [x] Query-time embedding cached for the duration of the call
- [x] Ingest-time embedding: embed every chunk on insert; skip + warn if embedder fails
- [x] **Server-side final gate** after sandbox return:
  - Count tokens with `js-tiktoken p50k_base`
  - `internal_budget = floor(max_tokens * 0.9)` (10% safety margin per Loop 6 patch P2)
  - If `tokens_used > internal_budget`, truncate result items by score and set `results_truncated: true`
  - Never emit a response above `max_tokens`
- [x] Promote `pinakes.project.hybrid()` from stub to real implementation
- [x] Promote `pinakes.project.vec()` from stub to real implementation

#### Innovations included
- **B** (budget-shaped response primitive, battle-tested)

#### Tests (minimum 10) — 22 tests shipped
- [x] FTS5 BM25 ranking correctness on fixture
- [x] Vector distance ordering correctness
- [x] RRF hybrid returns expected top-k on fixture queries
- [x] `snippet()` returns bounded tokens (≤ requested)
- [x] Embedder swap: transformers → Ollama-mock works (factory test — Ollama/Voyage/OpenAI constructors verified)
- [x] Embedder failure: insert chunk → warning + continue without vec row (verified in Phase 2 ingester tests)
- [x] Budget gate: synthesize `execute` returning 100K tokens of text → response ≤ max_tokens
- [x] Budget gate 10% safety margin: user sets max_tokens=20000 → internal budget is 17550
- [x] Budget gate sets `results_truncated: true` when truncating
- [x] Query p95 <500ms on 5K-chunk fixture — **p95=405ms at 5100 chunks**

#### Acceptance criteria (Phase 4 exit gate per Loop 6 patch P8)
1. ✅ **Hit rate ≥70%** on hand-labeled ground truth queries against fixture repos — **achieved 100% (10/10)** with bundled MiniLM; no Ollama upgrade needed
2. ✅ Response p95 <500ms at 5K chunks — **p95=405ms at 5100 chunks**
3. ✅ Budget compliance 100% on adversarial suite — **5/5 adversarial tests pass**
4. ✅ Ingest throughput ≥5 files/sec — 3-file fixture completes in <1s

#### Key decisions referenced
- presearch.md §2.2 (embedders)
- presearch.md §2.3 (schema)
- presearch.md §3.5 (MiniLM assumption + fallback)

---

### Phase 4.5 — Write path ✅ COMPLETE (2026-04-09)

**Goal**: LLM can create, update, and remove wiki pages via sandbox bindings.

**Depends on**: Phase 4 (so writes trigger proper hybrid indexing with embeddings).

**Effort**: 1 day (actual: <½ day).

#### Requirements
- [x] `pinakes.project.write(path, content)` — create/overwrite `<wikiRoot>/<path>.md`
- [x] `pinakes.project.append(entry)` — append a timestamped entry to `<wikiRoot>/log.md`
- [x] `pinakes.project.remove(path)` — delete `<wikiRoot>/<path>.md` and cascade-remove from index
- [x] **Path containment**: `resolve(wikiRoot, sanitized)` must start with `wikiRoot`; reject `..`, absolute paths, symlinks escaping the root
- [x] **Extension enforcement**: only `.md` files can be written
- [x] **Size limit**: max 100KB per write (`PINAKES_MAX_WRITE_SIZE` env var)
- [x] **Rate limit**: max 20 writes per `execute` call
- [x] **Atomic writes**: tmp file + rename pattern (never leave half-written files)
- [x] **Write audit**: every write appends to `pinakes_log` (`kind: 'write'`) and `pinakes_audit`
- [x] chokidar picks up written file → ingester re-indexes
- [x] Update `PINAKES_EXECUTE_TYPES` to document `write`, `append`, `remove` bindings
- [x] `BindingDeps` gains `wikiRoot: string`

#### Tests (minimum 12) — 20 tests shipped
- [x] Path traversal rejection (`../../../etc/passwd` → error)
- [x] Absolute path rejection (`/tmp/evil.md` → error)
- [x] Extension rejection (`.js`, `.json`, `.env` → error)
- [x] Size limit enforcement (>100KB → error)
- [x] Rate limit enforcement (21st write in one call → error)
- [x] Successful write: file appears on disk with correct content
- [x] Write + re-ingest: written file is indexed (node + chunks in DB) — integration test verifies write → ingest → FTS queryable
- [x] Append to log.md: entry added with timestamp
- [x] Remove: file deleted, node removed from index on next ingest
- [x] Scope containment: symlink escape rejected
- [x] Audit trail: every write produces `pinakes_log` rows
- [x] Atomic write: no tmp files left on success

#### Acceptance criteria
1. ✅ All 12+ tests pass — **20 tests shipped**
2. ✅ Write → read round-trip works end-to-end (sandbox write test)
3. ✅ No file can be written outside the wiki directory (path traversal + symlink tests)
4. ✅ Every write is audit-logged (3 audit tests: write, append, remove)

#### Key decisions referenced
- presearch.md D35 (standalone self-sufficient MCP)

---

### Phase 5 — Personal KG + privacy invariant ✅ COMPLETE (2026-04-09)

**Goal**: second scope (personal) + the locked privacy invariant, verified adversarially.

**Depends on**: Phase 4.5.

**Effort**: 1 day.

#### Requirements
- [x] Separate SQLite file for personal KG at `~/.pinakes/pinakes.db`
- [ ] **Personal KG LRU cap — 5,000 chunks hard** (per Loop 6.5 A2) — deferred to Phase 7 polish
  - [x] `last_accessed_at INTEGER NOT NULL` on `pinakes_nodes` bumped on every read that returns the node
  - [ ] On personal-KG ingest, check `SELECT COUNT(*) FROM pinakes_chunks` where the node is in personal scope
  - [ ] If count > 5000, `DELETE FROM pinakes_nodes WHERE scope='personal' ORDER BY last_accessed_at ASC LIMIT (count - 5000)` (cascades to chunks/edges/vec)
  - [ ] Eviction logged to `pinakes_log` with count and freed chunks
  - [x] Project KG has NO cap — bounded by the repo's wiki files
- [x] **Audit log SPLIT BY SCOPE** (per Loop 6.5 A1 — CRITICAL privacy fix):
  - [x] `scope='project'` audit rows → `pinakes_audit` table in project `.pinakes/pinakes.db` + mirror to `.pinakes/audit.jsonl`
  - [x] `scope='personal'` OR `scope='both'` audit rows → separate `pinakes_audit` table in `~/.pinakes/pinakes.db` + mirror to `~/.pinakes/audit.jsonl`
  - [x] **Merge blocker test**: a `scope='personal'` tool call leaves zero new bytes in `.pinakes/audit.jsonl` and appends to `~/.pinakes/audit.jsonl`
- [x] `scope` param threaded end-to-end: tool schema → dispatcher → binding injection → sandbox env
- [x] Dispatcher logic:
  ```typescript
  if (call.scope === 'project' || call.scope === 'both') {
    env.pinakes.project = bindProject();
  }
  if (call.scope === 'personal' || call.scope === 'both') {
    env.pinakes.personal = bindPersonal();
  }
  // If scope = 'project', env.pinakes.personal does not exist — accessing it throws
  ```
- [x] `pinakes.describe()` returns summary counts + top topics for each available scope (no content, just metadata)
- [x] Every tool call appends a row to `pinakes_audit` with `scope_requested`, `tool_name`, `caller_ctx`, `response_tokens`
- [x] Ingester classifies scope from path convention:
  - `.pinakes/wiki/*` → `scope='project'`
  - `~/.pinakes/wiki/*` → `scope='personal'`
  - (Queue subscriber will provide explicit scope field when contract lands)
- [x] Personal-scope write bindings follow the same dispatcher-level gating: `pinakes.personal.write()` only available when `scope` includes `'personal'`
- [x] Any cross-scope result from `scope='both'` queries is tagged with `source_scope: 'project' | 'personal'` on every returned object (Loop 6 patch P9)
- [x] `.pinakes/audit.jsonl` mirror of `pinakes_audit` table for `tail -f` observability

#### Innovations included
- **C** (structural privacy binding)

#### Tests (minimum 10 + 15 adversarial = 25) — 25 tests shipped
**Adversarial privacy suite (15 tests, merge blocker)** — **15/15 PASS**:
- [x] `scope='project'` then `execute("return pinakes.personal.fts('x')")` → throws
- [x] `scope='project'` then `execute("return pinakes['personal']?.fts?.('x')")` → returns `undefined`
- [x] `scope='project'` then `execute("return Object.keys(pinakes)")` → does not include `'personal'`
- [x] `scope='project'` then `execute("return JSON.stringify(pinakes)")` → does not include personal content
- [x] `scope='project'` then `for-in` enumeration does not find `'personal'`
- [x] `scope='project'` then `Object.getOwnPropertyNames(pinakes)` → does not include `'personal'`
- [x] `scope='project'` then `pinakes.describe()` → result does not include `personal` field
- [x] `scope='project'` then `neighbors()` with personal node id → returns empty
- [x] `scope='project'` → no file API (require, process, fetch) exists in sandbox
- [x] `scope='project'` → logger.log has no access to personal data
- [x] `scope='both'` → both namespaces accessible, results from both scopes
- [x] `scope='personal'` → `pinakes.project` NOT available, only `pinakes.personal`
- [x] Audit log row / meta.scope exists for every call with requested scope
- [x] Changing scope between calls works (stateless dispatcher)
- [x] `scope='project'` when personal DB is missing → still works

**Non-adversarial (10 tests)** — **10/10 PASS**:
- [x] `pinakes.describe()` returns project + personal counts for `scope='both'`
- [x] `pinakes.describe()` hides `personal` key for `scope='project'`
- [x] Personal DB absent → project queries work fine
- [x] `scope='project'` → `pinakes.personal.write('x', 'leak')` throws
- [x] `pinakes.personal.fts()` works in `scope='personal'`
- [x] `pinakes.personal.write()` works in `scope='personal'`
- [x] `source_scope` tag on every `search` result from `scope='both'`
- [x] Audit JSONL split: personal scope writes to separate path
- [x] Project and personal can coexist
- [x] Personal scope requested without personal DB → error

#### Acceptance criteria
1. ✅ All 25 tests pass
2. ✅ 15/15 privacy adversarial suite passes (merge blocker)
3. ✅ Audit JSONL split by scope verified
4. ✅ `scope='both'` merges results from both KGs, each tagged with `source_scope`

#### Key decisions referenced
- presearch.md §2.10 (verification)
- presearch.md §3.1 F2 (privacy leak mitigation)
- Loop 6 patches P9 (source_scope tagging)

---

### Phase 6 — Provenance + read-only gap detection ✅ COMPLETE (2026-04-09)

**Goal**: confidence tags on every claim + a read-only gap-detection query surface.

**Depends on**: Phase 5.

**Effort**: 1 day.

#### Requirements
- [x] Ingester assigns `confidence` on every node (default `extracted`; `inferred` if source is a Haiku-generated summary; `ambiguous` if source is flagged)
- [x] Provenance metadata: every node has `source_uri` pointing back to the markdown file
- [x] LLM can filter by confidence via code-mode: `.filter(r => r.confidence === 'extracted')`
- [x] Gap detection pass on ingest:
  - [x] After an ingest transaction commits, scan the new node's `body` for concept mentions
  - [x] A "concept" is a noun phrase that appears ≥3 times across the KG but has no dedicated `pinakes_nodes` row
  - [x] Upsert into `pinakes_gaps` with `concept`, `first_seen_at`, `mentions_count`
  - [x] Gaps get `resolved_at` set when a dedicated node for the concept is later created
- [x] Read-only access to gaps via `pinakes.project.gaps()` and (with scope) `pinakes.personal.gaps()` bindings
- [x] **Gap filling is self-contained**: `pinakes.project.gaps()` surfaces unresolved gaps; the LLM fills them by calling `pinakes.project.write()` to create new wiki pages. Re-indexing resolves the gap in `pinakes_gaps`. No external coordination needed.

#### Innovations included
- **D** (provenance-tagged claims)
- **E** (gap detection + self-contained fill loop via write bindings)

#### Tests (minimum 10)
- [x] Confidence assigned correctly on ingest (3 cases: extracted, inferred, ambiguous)
- [x] Filter by confidence inside `execute` works
- [x] Gap detection fixture: 3 concept mentions → 1 `pinakes_gaps` row
- [x] Gap resolution: dedicated node created → `resolved_at` set
- [x] `pinakes.project.gaps()` returns unresolved gaps
- [x] `pinakes.project.gaps({ resolved: true })` returns historical resolutions
- [x] `pinakes.personal.gaps()` respects scope
- [x] Gap fill via write: `pinakes.project.write('gap-topic', ...)` → gap resolved on next ingest
- [x] `source_uri` present on every node returned from queries

#### Acceptance criteria
1. ✅ Confidence tag visible in query results
2. ✅ Gaps detected on fixture repo match expected list (hand-labeled)
3. ✅ Gap resolution lifecycle works
4. ✅ Gap fill via `pinakes.project.write()` resolves gap lifecycle end-to-end

#### Key decisions referenced
- presearch.md §Loop 1.5 innovation D + E
- Loop 6 patch P1 (coordination)

---

### Phase 7 — Polish, testing, observability (MVP ship) ✅ COMPLETE

**Goal**: bring the MVP to acceptance quality.

**Depends on**: Phase 6.

**Effort**: 1 day.

**Completed**: 2026-04-09. 155 tests across 16 files, all green.

#### Requirements
- [x] All tests green in CI (80+ total across phases) — **155 tests, 16 files**
- [x] Pino logger wired to stderr with a correlation id per tool call — `instrumentHandler` in `serve.ts` generates UUID per call, threads via `logger.child({callId, tool, scope})`
- [x] Metrics dump on SIGHUP: emit all counters as a single JSON line to stderr — `src/observability/metrics.ts`
- [x] CLI subcommands (Loop 6 patch P5):
  - [x] `pinakes serve --wiki-path <path>` (default, runs the stdio server) — Phase 2
  - [x] `pinakes rebuild --wiki-path <path>` (full rebuild from markdown) — Phase 2
  - [x] `pinakes status` (dump connection + row counts + last log entry) — Phase 2
  - [x] `pinakes audit --tail` (tail `pinakes_audit` table) — `src/cli/audit.ts`
  - [x] `pinakes purge --scope <s> [--confirm]` (delete a scope's DB) — `src/cli/purge.ts`
  - [x] `pinakes export --scope <s> [--out file.json]` (dump a scope's nodes + edges) — `src/cli/export.ts`
  - [x] `pinakes import --scope <s> --in file.json` (restore from dump) — `src/cli/import.ts`
- [x] `README.md` with:
  - Install (clone + build)
  - Config snippets for Claude Code (`claude mcp add`), Goose, Codex, OpenCode, Cursor
  - Example queries + writes
  - Embedder upgrade path (Ollama, Voyage, OpenAI)
- [x] `CLAUDE.md` for this repo itself (project conventions) — existed since Phase 0
- [x] Version pin audit (Loop 0 gotchas):
  - [x] SQLite 3.51.3 (confirmed via better-sqlite3@12.8.0 — not 3.51.0)
  - [x] sqlite-vec 0.1.9 pinned
  - [x] `@cloudflare/codemode` vendored (4 pure-JS helpers, dep removed per presearch D30)
  - [x] `@modelcontextprotocol/sdk ^1.29.0` pinned
- [x] `npm audit` clean (no critical/high vulnerabilities) — production deps clean; 1 moderate dev-only vuln in vite (vitest transitive dep, not fixable without vitest v3 upgrade)
- [x] Fresh-install end-to-end test — `src/__tests__/cli/e2e.test.ts`: 9 tests covering 5 queries (search, search+budget, execute FTS, execute hybrid, execute write+read) + 4 CLI subcommand tests (status, export→import round-trip, purge safety, audit)

#### Innovations included
None new (polish phase).

#### Tests
- 9 new e2e tests in `src/__tests__/cli/e2e.test.ts`
- Total: 155 tests across 16 files (was 146 before Phase 7)

#### Acceptance criteria
1. ✅ All tests green — 155/155
2. ✅ README + CLAUDE.md written
3. ✅ Fresh-install round-trip test passes (9 tests)
4. ✅ `npm audit` clean (production); 1 moderate dev-only (vite via vitest)

#### Key decisions referenced
- presearch.md §2.8 (observability)
- Loop 6 patch P5 (CLI tooling)

#### Implementation notes
- Audit rows written via `instrumentHandler` wrapper in `serve.ts` — scope-split per CLAUDE.md §Security #7 (project → `.pinakes/audit.jsonl`, personal → `~/.pinakes/audit.jsonl`)
- Metrics counters: tool_calls, tool_errors, tool_latency_ms (per tool), ingest_files, ingest_errors, uptime_s
- esbuild override `>=0.25.0` in `package.json` to resolve GHSA-67mh-4wv8-2f99
- vite moderate vuln (GHSA-4w7w-66w2-5vf9) cannot be overridden without breaking vitest 2.x compatibility; accepted as dev-only

---

### Phase 7.5 — Recall-optimized search + LLM-as-precision-layer

**Goal**: Reframe search architecture around recall (getting the right file into top-20) and let the calling LLM handle precision (picking from candidates). Revert the precision-focused RRF weighting from Phase 7, enrich result metadata for LLM triage, and add a wiki index for LLM-driven browsing.

**Depends on**: Phase 7.

**Effort**: 1 day.

**Insight**: Ablation testing on wiki-1000 (6051 chunks) revealed:
- FTS-only: 7.5% hit rate @5 (multi-word queries fail at scale)
- Vec-only: 95% hit rate @5, 60% @1 (great recall, weak precision)
- Hybrid RRF: 95% @5, 57.5% @1 (FTS noise slightly hurts @1)

But @1 precision doesn't matter because the consumer is a frontier LLM (Opus/Sonnet) writing code-mode queries. The LLM reads 10-20 results and filters with its own intelligence. **The search system is the recall layer; the LLM is the precision layer.** This is the core code-mode thesis.

#### Requirements

##### 7.5.1 — Revert hybrid.ts to equal-weight RRF (maximize recall)
- [ ] Remove `computeFtsWeight()`, `filterByBm25()`, `FTS_WEIGHT_STRONG` from `src/retrieval/hybrid.ts`
- [ ] Restore `rrfFuse()` to use equal weighting (no `ftsWeight` parameter): `rrfScore = 1 / (rrfK + rank)` for both FTS and vec
- [ ] Restore `hybridSearch()` to pass raw FTS results directly to `rrfFuse()` (no filtering)
- [ ] Goal: maximize recall by letting both FTS and vec contribute equally — FTS catches exact keyword matches that vec might rank lower, vec catches semantic matches that FTS misses

**Files to change**: `src/retrieval/hybrid.ts` only.

**Before** (current, broken):
```typescript
const ftsResults = filterByBm25(rawFts);
const ftsWeight = computeFtsWeight(ftsResults, vecResults);
return rrfFuse(ftsResults, vecResults, rrfK, limit, ftsWeight);
```

**After** (restored):
```typescript
return rrfFuse(ftsResults, vecResults, rrfK, limit);
// rrfFuse signature: (fts, vec, rrfK, limit) — no weight param
```

##### 7.5.2 — Enrich result metadata for LLM triage
- [ ] Add `title` and `section_path` to `HybridResult` in `src/retrieval/hybrid.ts`
- [ ] Populate them from the existing JOIN to `pinakes_nodes` in both `ftsQuery()` and `vecQuery()`
- [ ] Add `title` and `section_path` to `FtsResult` in `src/retrieval/fts.ts` — extend the SELECT to include `n.title` and `n.section_path`
- [ ] Add `title` and `section_path` to `VecResult` in `src/retrieval/vec.ts` — extend the SELECT to include `n.title` and `n.section_path`
- [ ] Update `TaggedResult` in `src/mcp/tools/search.ts` to include `title` and `section_path` so `search` returns them
- [ ] Update `PINAKES_EXECUTE_TYPES` in `src/mcp/tools/execute.ts` to document the new fields in the type declarations

**Why**: The LLM needs to see titles and section paths to triage results without reading full content. Currently it only sees `text` (chunk body) and `source_uri` (file URL). Adding `title: "OAuth2 Authorization Code Flow"` and `section_path: "Authentication / OAuth2"` lets the LLM instantly judge relevance.

**SQL changes** in `fts.ts`:
```sql
-- Before:
SELECT c.id, c.text, snippet(...), n.source_uri, n.id AS node_id, bm25(...) AS rank, n.confidence
-- After:
SELECT c.id, c.text, snippet(...), n.source_uri, n.id AS node_id, bm25(...) AS rank, n.confidence, n.title, n.section_path
```

Same pattern for `vec.ts`.

##### 7.5.3 — Add `pinakes.project.index()` binding for LLM-driven browsing
- [ ] Add a new binding `pinakes.project.index(opts?)` that returns a compact list of all nodes: `Array<{ id, title, source_uri, section_path, kind, token_count }>`
- [ ] Optional filter: `opts.kind` (e.g., `'section'`), `opts.source_uri` (filter to one file)
- [ ] Limit to 500 results by default (avoid blowing the budget on a 6000-node KG)
- [ ] Sort by `source_uri, section_path` for natural file→section ordering
- [ ] This is the Karpathy `index.md` pattern: the LLM reads the table of contents and decides which sections to drill into via `pinakes.project.get(id)`

**Files to change**:
- `src/sandbox/bindings/pinakes.ts` — add the `index` binding alongside `fts`, `vec`, `hybrid`, `get`, `neighbors`
- `src/mcp/tools/execute.ts` — add `index()` to `PINAKES_EXECUTE_TYPES`

**Binding implementation** (in `pinakes.ts`, new SQL query):
```sql
SELECT id, title, source_uri, section_path, kind, token_count
  FROM pinakes_nodes
 WHERE scope = ?
 ORDER BY source_uri, section_path
 LIMIT ?
```

**Type declaration** (in `PINAKES_EXECUTE_TYPES`):
```typescript
/** Table of contents — list all nodes for LLM-driven browsing. */
index(opts?: { kind?: string; source_uri?: string; limit?: number }): Array<{ id: string; title: string | null; source_uri: string; section_path: string; kind: string; token_count: number }>;
```

##### 7.5.4 — Update tool descriptions to guide LLM behavior
- [ ] Update `search` description in `src/mcp/tools/search.ts` to mention that results include `title` and `section_path` for quick triage
- [ ] Update `execute` description in `src/mcp/tools/execute.ts` to document the `index()` binding and the recommended pattern: "Use `pinakes.project.index()` to browse the wiki table of contents, then `pinakes.project.get(id)` to read specific sections."
- [ ] Keep total schema footprint under 1500 tokens (measure via js-tiktoken)

##### 7.5.5 — Update golden set tests to validate recall, not precision
- [ ] In `src/__tests__/golden-sets.test.ts`, change the primary metric from hit rate @5 to hit rate @10 and @20
- [ ] Add a test for `pinakes.project.index()` — verify it returns a usable table of contents
- [ ] Verify that the enriched metadata (title, section_path) appears in search results

##### 7.5.6 — Ablation test update
- [ ] In `src/__tests__/retrieval-ablation.test.ts`, add @10 and @20 hit rates to the comparison table
- [ ] After reverting to equal RRF, hybrid @20 recall should be >= vec @20 recall (FTS catches different things)

#### Acceptance criteria
1. `hybrid.ts` uses equal-weight RRF with no adaptive weighting or BM25 filtering
2. `search` and `pinakes.project.hybrid()` results include `title` and `section_path`
3. `pinakes.project.index()` returns a browsable table of contents
4. Golden set wiki-1000: hybrid hit rate @10 >= 95%
5. Schema footprint stays under 1500 tokens
6. All existing tests pass (155+ from Phase 7)

#### Key architectural decisions
- **LLM is the precision layer**: The search system optimizes for recall (get the right document into top-20). The calling LLM handles precision via code-mode filtering, title-based triage, and multi-step queries.
- **Both FTS and vec contribute to recall**: FTS catches exact keyword matches that vec might miss (e.g., searching for "PKCE" as an exact token). Vec catches semantic matches that FTS misses. Equal RRF fusion maximizes the union of both result sets.
- **Index browsing enables Karpathy pattern**: `pinakes.project.index()` gives the LLM a table of contents. Combined with `pinakes.project.get(id)`, this enables the LLM to browse the wiki like a human would — scan titles, then read interesting sections. This is the original Karpathy insight: the LLM IS the search engine.
- **Embeddings remain optional but beneficial**: The bundled MiniLM model provides 95% recall @5 at zero cost. Users can upgrade to Ollama/Voyage for better quality. But even without embeddings, the LLM can use `index()` + `fts()` + `get()` to navigate effectively.

#### Non-goals (explicitly deferred)
- Better embedding model — not needed for recall; @1 precision is the LLM's job
- Cross-encoder reranking — same reasoning; LLM handles precision
- FTS tokenizer changes — FTS is fine as a recall contributor, not the primary ranker
- Removing embeddings — they add recall coverage, keep them

---

### Phase 8 — v1 stretch (post-MVP)

**Goal**: the stretch innovations from Loop 1.5.

**Depends on**: MVP shipped and validated against real usage.

**Effort**: multi-day, unscoped. **Requires a v1 mini-presearch** before committing to shape.

#### Tentative requirements (do NOT commit without mini-presearch)
- [ ] **F** — Time-travel queries via `log.md` replay: `pinakes.project.log.replay({ at: timestamp })` returns a point-in-time view
- [ ] **G** — Personal KG "skill observation" background sub-agent that auto-writes to personal wiki via `pinakes.personal.write()`
- [ ] **H** — Contradiction detector (pairwise LLM judge over wiki chunks with opposing claims)
- [ ] Tree-sitter code parser replacing markdown-only ingestion
- [ ] Multi-language symbol extraction via `tree-sitter-language-pack`
- [ ] Graph algorithms (PageRank, Louvain) as code-mode bindings
- [ ] Optional orchestrator integration (Redis pub/sub for external event sources)

#### Acceptance criteria
Deferred to v1 mini-presearch.

---

## Phase dependency map

```
Phase 0 (Scaffold) ✅
  └── Phase 1 (Spike) ✅
       └── Phase 2 (Persistence + ingest) ✅
            ├── Phase 3 (Sandbox full) ✅
            └── Phase 4 (Hybrid + budget) ✅
                 └── Phase 4.5 (Write path) ✅
                      └── Phase 5 (Personal KG + privacy) ✅
                           └── Phase 6 (Provenance + gaps) ✅
                                └── Phase 7 (Polish + MVP ship) ✅
                                     └── Phase 7.5 (Recall-optimized search)
                                          └── Phase 8 (v1 stretch)
```

**Critical path**: 0 → 1 → 2 → 3 → 4 → 4.5 → 5 → 6 → 7 → 7.5. **MVP phases (0-7) complete.** Phase 7.5 is a search quality refinement based on ablation testing.

**Parallelization opportunity**: after Phase 2, Phase 3 (sandbox bindings) and Phase 4 (retrieval implementation) can be partially parallel — they share the `KGSide` interface but touch different files.

---

## MVP validation checklist

Every brief requirement mapped to a phase and test:

| # | Requirement | Phase | Innovation | Test coverage |
|---|---|---|---|---|
| R1 | Builds on Karpathy's idea (ingest/query/lint) | P2 (ingest+query) + P6 (lint read-only) + P8 (lint write) | — | ingest + gap tests |
| R2 | Self-expanding | P6 (detect) + P4.5 (write) | E | gap detection tests |
| R3 | Fills knowledge gaps on its own | P6 + P4.5 | E | gap lifecycle tests |
| R4 | Enhanced with SQLite | P2 | — | 15+ schema tests |
| R5 | Enhanced with code-mode | P1 (minimal) + P3 (full) | A | 20+ sandbox tests |
| R6 | Delivered as MCP | P1 | — | integration tests |
| R7 | Connects to any MCP client | P1 + P7 | — | smoke test + config snippets |
| R8 | Precise & valuable context | P4 | B | hit rate tests (≥70% gate) |
| R9 | Not token-hungry | P4 | B | budget compliance tests (100%) |
| R10 | Indexing important | P2 + P4 | — | query plan tests |
| R11 | Expandable as app grows | P2 | — | drizzle migration tests |
| R12 | Personal KG | P5 | C | scope tests |
| R13 | Project KG | P2 + P5 | C | scope tests |
| R14 | Operates at both levels | P5 | C | describe() + both-scope tests |
| R15 (Q&A) | Coding agent direct consumer | P1 | — | stdio smoke test |
| R16 (Q&A) | Full code-mode pattern | P1 + P3 | A | sandbox tests |
| R17 (Q&A) | Isolated + LLM-driven bridge | P5 | C | describe() tests |
| R18 (Q&A) | Multi-source ingest via queue | P2 | — | IngestSource interface tests (+ OQ2 resolution) |
| R19 (Q&A) | Something working today | P1 | A + B | Phase 1 acceptance |
| R20 (Q&A) | Local models ideal, config for others | P4 | — | embedder swap tests |
| R21 (Q&A) | Structural privacy invariant | P5 | C | 15 adversarial tests |

## Innovation tracking table (revised per Loop 6.5 A7)

| # | Innovation / feature | Class | Phase | Acceptance gate |
|---|---|---|---|---|
| A | Code-mode native KG API | **CORE innovation** | P1 + P3 | P1 spike 11/11 + P3 tests ≥20 |
| B | Budget-shaped response primitive | **CORE baseline** (table stakes, not innovation) | P1 + P4 | P1 budget sanity check + P4 100% compliance |
| C | Structural privacy binding | **CORE innovation** | P5 | 15-test adversarial suite 15/15 + audit log split merge-blocker test |
| D | Provenance-tagged claims | **CORE baseline** (not innovation) | P6 | confidence filter test |
| E | Gap detection (read-only) | **CORE innovation** | P6 | gap lifecycle tests |
| Cross-KG discovery via `pinakes.describe()` | **CORE innovation** (re-promoted after sharpening) | P5 | describe() returns exactly `{node_count, top_tags, last_updated}` per scope; scope='project' omits personal key entirely |
| E (full) | Gap detection (write loop) | **CORE** (promoted by D35) | P4.5 + P6 | write binding + gap lifecycle tests |
| F (CUT→STRETCH) | Time-travel on log replay | STRETCH | P8 | deferred to v1 presearch; now feasible since we own the log format |
| G | Personal KG skill observations | STRETCH | P8 | deferred to v1 presearch |
| **H (NEW)** | Contradiction detector (pairwise LLM judge over wiki chunks with opposing claims) | **STRETCH innovation** | P8 | deferred to v1 presearch; genuinely novel vs obra/knowledge-graph + basic-memory |

**Final: 4 CORE innovations + 2 CORE baselines + 3 STRETCH innovations, 1 cut.**

## Stretch goals (ordered by impact)

1. **Tree-sitter code parser** — unlocks "KG of the codebase" pitch beyond markdown-only.
2. **G** — personal KG skill observations via `pinakes.personal.write()`.
3. **H** — contradiction detector (pairwise LLM judge).
4. **F** — time-travel queries, niche but unique.

---

## Open questions to resolve before or during each phase

| # | Question | Resolve by |
|---|---|---|
| OQ1 | MCP client registration flow (Claude Code, Goose, Codex, etc.) | Phase 7 (docs) |
| OQ2 | Optional orchestrator queue integration (e.g. Redis pub/sub) | Optional — ChokidarWatcher sufficient for standalone |
| ~~OQ3~~ | ~~Wiki-updater proposals file protocol~~ | **Dissolved by D35** — write path is self-contained |
| ~~OQ4~~ | ~~Extend pharos.db or separate file?~~ | **Dissolved by D35** — standalone `.pinakes/pinakes.db` |
| ~~OQ5~~ | ~~Pharos settings UI for API keys~~ | **Dissolved by D35** — env vars only, client-agnostic |
