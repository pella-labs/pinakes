# Pinakes — Pre-Implementation Research Document

> **Project**: a standalone code-mode MCP server that manages a two-level Karpathy knowledge wiki (project + personal) with full read/write lifecycle. Works with any MCP client: Claude Code, Codex, Goose, OpenCode, Cursor.
>
> **Status**: architecture locked. Ready for Phase 0 scaffold + Phase 1 spike.
>
> **Date**: 2026-04-08
>
> **Author**: Sebastian, solo (Challenger teammate shut down mid-loop; all critique performed as rigorous self-review per the Presearch v2 skill's "lead makes the call" fallback)

---

## TL;DR

A local stdio MCP server, written in TypeScript, that:
1. Indexes markdown knowledge-wiki files (project `.pinakes/wiki/` + personal `~/.pinakes/wiki/`) into SQLite with FTS5 + sqlite-vec.
2. Exposes exactly two MCP tools — `search` and `execute` — to the coding LLM.
3. `execute` runs LLM-written JavaScript in a sandboxed QuickJS environment with `pinakes.project` and (optionally, scope-gated) `pinakes.personal` bindings. This is Cloudflare's code-mode pattern applied to a local knowledge graph.
4. Every response is budget-shaped to fit under Claude Code's **hard 25,000-token MCP tool response cap**, with a 10% safety margin.
5. Reuses `@cloudflare/codemode`'s pluggable `Executor` interface, so we only write ~300 LOC of Node-side sandbox code, not the whole code-mode layer.
6. Ships with a bundled local embedder (`@xenova/transformers` + quantized MiniLM-L6-v2). Opt-in upgrades to Ollama `nomic-embed-text` or Voyage `voyage-code-3`.
7. Enforces a structural privacy invariant at the tool dispatcher layer — the sandbox physically does not receive a `pinakes.personal` binding unless the caller's `scope` param includes `'personal'`.
8. Owns the write path: `pinakes.project.write(path, content)` inside `execute` writes markdown to disk (atomic rename), chokidar triggers re-indexing. Safety constraints: path containment, `.md` only, 100KB max, 20 writes/call, audit-logged.

**Markdown is canonical. SQLite is the index.** If the index is lost, we rebuild from markdown. If markdown is lost, we have a bug.

---

## Mode

**Standalone greenfield project.** A self-sufficient knowledge base MCP server that any coding tool can plug into. Originally conceived as a Pharos extension (D7), pivoted to standalone per D35 (2026-04-09). Pharos compatibility preserved via `--wiki-path` flag but is not a dependency.

---

## Loop 0: Research Brief

See `dev-docs/research-brief.md` for the full sourced findings. Summary of decision-shaping points:

1. **Claude Code enforces a hard 25,000-token cap on every MCP tool response.** The single most important constraint. Code-mode is not an optimization but a structural necessity. ([community discussion](https://github.com/orgs/community/discussions/169224))
2. **`@cloudflare/codemode` has a pluggable `Executor` interface** — we reuse `generateTypesFromJsonSchema`, `normalizeCode`, `sanitizeToolName`, `ToolDispatcher`. Only write a ~200-400 LOC Node Executor. Independent OSS port at [jx-codes/codemode-mcp](https://github.com/jx-codes/codemode-mcp).
3. **Sandbox choice narrows to two**: `isolated-vm` (V8 isolate, fast, soft memory cap) vs `quickjs-emscripten` (WASM, ~50× slower but hard memory cap, zero native deps). **QuickJS wins** for our workload — sub-10ms queries, structurally stronger isolation.
4. **SQLite substrate**: FTS5 3.51.0 has a shipped regression (pin 3.50.4 or 3.51.3+). `sqlite-vec` is pre-v1. Hybrid retrieval via RRF in a single CTE is the canonical pattern (Alex Garcia's blog).
5. **Karpathy's wiki is NOT SQLite** — it's markdown files + `qmd` for search. Any "SQLite + Karpathy" framing is synthesis, not port. **Markdown canonical, SQLite index** is the explicit design call.
6. **Prior art**: `obra/knowledge-graph` (closest architectural match — TS + better-sqlite3 + sqlite-vec + FTS5 + MCP), `tobi/qmd` (20k★, named in Karpathy's gist, BM25+vector+LLM-rerank+RRF, Node+GGUF), `basicmachines-co/basic-memory` (2.8k★, Python MCP implementing the 3 Karpathy workflows), `jx-codes/codemode-mcp` (OSS code-mode port).
7. **Embeddings**: bundled `@xenova/transformers` with quantized MiniLM-L6-v2 (22MB, 384-dim) as default — zero config. Ollama + Voyage + OpenAI as opt-in upgrades.
8. **MCP transport**: stdio for local (Claude Code + Goose use stdio). SSE deprecated. Streamable HTTP is for remote.
9. **No accurate local Claude tokenizer for Claude 3+**; use `js-tiktoken p50k_base` with 10% safety margin.
10. **`isError: true` display bug in Claude Code** — errors show as `Error: undefined`. Don't rely on error content for self-recovery; put actionable info in normal result payloads.

---

## Loop 1: Constraints (LOCKED)

### 1.1 Domain & use cases

**Problem**: A coding LLM has no persistent, queryable memory across sessions. We build a standalone knowledge base that the LLM can read, write, and query via two MCP tools.

**Five core use cases** (the LLM is the user):
1. "What do I already know about module X?" — project KG retrieval mid-task.
2. "Has this developer hit this kind of problem before?" — cross-project personal KG retrieval.
3. "What was decided about auth in this repo?" — targeted architecture/decision lookup.
4. "Where are the gaps?" — Karpathy lint query surface.
5. "Log this new finding" — LLM writes via `pinakes.project.write()` or `pinakes.project.append()` (markdown canonical invariant preserved).

**Scope boundary**: we own the full lifecycle: READ, WRITE, INDEX, QUERY, and GAP-DETECT. Write operations via `pinakes.project.write()` inside `execute` (see D35).

### 1.2 Scale & performance (LOCKED)

| Metric | Spike (today) | MVP (Pharos v0.2) | v1 target |
|---|---|---|---|
| Wiki files per project | 6 | 20 | 100 |
| Project chunks | ~60 | ~500 | ~8,000 |
| Personal chunks | 0 | ~500 | ~2,000 |
| Query p50 latency | <50 ms | <100 ms | <150 ms |
| Query p95 latency | <200 ms | <500 ms | <1 s |
| Ingest throughput | 1 file/s | 5 files/s | 20 files/s |
| Response size (tokens) | ≤5K | ≤5K default, ≤20K ceiling | same |

**Binding constraint is response size, not DB size.** sqlite-vec brute-force handles 50K+ vectors at sub-200ms; FTS5 is "upper edge of practical" at 1M docs. We are nowhere near those limits.

### 1.3 Budget & cost ceiling (LOCKED)

| Category | Budget |
|---|---|
| Development | engineering time only |
| Embedding (default, bundled transformers.js) | **$0** |
| Embedding (opt-in Voyage, OpenAI, Cohere) | user-provided API key |
| Lint LLM calls (Haiku via claude-acp) | **$0** to us — user's own Max quota |
| Runtime memory | <200 MB resident |
| Disk | ~35 MB per project KG + ~15 MB personal at v1 scale |

We trade nothing for money. Default stack is local + free.

### 1.4 Time to ship (LOCKED)

| Milestone | When | Scope |
|---|---|---|
| **Feasibility spike** | **Today** | stdio MCP + minimal `search` + `execute` with QuickJS sandbox + budget gate + in-memory store. **Includes code-mode path** (omitting it invalidates the feasibility test). |
| **MVP** | Aligned with Pharos Phase 4 cutover | full SQLite schema, chokidar ingestion, hybrid RRF retrieval, both KGs with privacy invariant, provenance tags, read-only gap detection |
| **v1** | Pharos v1 | gap-fill writer loop (closes Karpathy lint), time-travel queries, tree-sitter code parser, multi-language symbol extraction |

### 1.5 Data sensitivity (LOCKED)

- **Project KG**: lives in `.pinakes/wiki/`. User's source code metadata and decisions. Can be .gitignored or committed.
- **Personal KG**: lives in `~/.pinakes/wiki/`. Cross-project developer learnings. **Never leaves machine** by default. Embedding API opt-in is per-KG, not global.
- **Prompt injection surface**: ingested wiki content is treated as untrusted data. Sandbox has no `eval`/`Function`/`fetch`/`require`, so ingested text cannot execute.
- **No PII, compliance, or data residency requirements.** Single-user local tool.

### 1.6 Team & skill constraints (LOCKED)

TypeScript / Node / SQLite comfortable. MCP / QuickJS / Cloudflare code-mode new — lean on libraries, don't roll our own. Tree-sitter / LSP deferred to v1.

### 1.7 Reliability (LOCKED)

- **Non-negotiable**: privacy invariant. Enforced at tool dispatcher, audited on every call, tested adversarially.
- **Budget compliance**: 100%. Never emit a response >25K tokens.
- **Audit logging**: every MCP call → `pinakes_audit` table + `.pinakes/audit.jsonl` mirror.

### 1.8 Testable proxy metrics for MVP

- **Hit rate**: ≥70% on hand-labeled ground truth against Pharos fixture repos.
- **Budget compliance**: 100%.
- **Privacy invariant**: 0 leaks (verified by 15-test adversarial suite).
- **Latency**: p95 < 500ms.

---

## Loop 1.5: Innovations (LOCKED — 5 core + 2 stretch)

After self-critique cut the original 12 candidates down to the 7 that are actually novel vs competitors:

### CORE (MVP commit)

| # | Innovation | Category | Why it matters |
|---|---|---|---|
| **A** | **Code-mode native KG API** | Novel AI Application | The core thesis. LLM writes JS, filters and projects locally, returns only what fits the budget. Cloudflare validated the pattern at ~81% token reduction. |
| **B** | **Budget-shaped response primitive** | UX Excellence | Every response counts tokens and truncates to fit under the 25K cap. Novel in MCP space because the cap is new. Never surfaces an "exceeds max" error to the caller. |
| **C** | **Structural privacy binding** | Production Hardening | `pinakes.personal` binding physically injected into the sandbox ONLY when scope includes `'personal'`. Enforced at dispatcher, audited. Unbypassable via prompt injection because the binding doesn't exist for project-scoped calls. |
| **D** | **Provenance-tagged claims** | Production Hardening | Every node carries `confidence ∈ {extracted, inferred, ambiguous}` + source_uri. LLM can filter by confidence via code-mode. Borrowed from Ar9av/obsidian-wiki. |
| **E** | **Gap detection (read-only)** | Novel AI Application | Karpathy's lint workflow, materialized. MVP detects and exposes via `pinakes.gaps()`. v1 closes the writer feedback loop. |

### STRETCH (v1 if time permits)

| # | Innovation | Category |
|---|---|---|
| **F** | Time-travel queries on `log.md` replay | Domain Intelligence |
| **G** | Personal KG as first real consumer of Pharos's profile wiki layout | Domain Intelligence |

### Rejected as "innovations" (moved to tech choices / baseline)

- LLM-driven cross-KG discovery → table stakes, it's the `pinakes.describe()` tool
- Token-counting metadata → obvious instrumentation
- Ollama-first embedding → tech choice
- Hybrid RRF → tech choice (canonical sqlite-vec pattern)
- Demo-ready first-run → UX polish, not a differentiator

---

## Loop 2: Architecture (LOCKED)

### 2.1 Core pattern

**Single-process stdio MCP server**, spawned by Goose as an MCP extension. Everything in-process: chokidar, SQLite writer, read pool, embedder, QuickJS sandbox, tool dispatcher. No sockets, no IPC, no sidecars.

```
┌─────────────────────────┐
│  chokidar (watch .md)   │──file change──┐
└─────────────────────────┘                │
                                            ▼
┌─────────────────────────┐    ┌─────────────────────────┐
│  Markdown parser (mdast)│───▶│  Ingester (writer lock) │
└─────────────────────────┘    └─────────────────────────┘
                                            │
                                            ▼
                               ┌─────────────────────────┐
                               │  SQLite (single writer) │
                               │  FTS5 + sqlite-vec      │
                               └─────────────────────────┘
                                            ▲
┌─────────────────────────┐    ┌─────────────────────────┐
│  MCP stdio (from Goose) │───▶│  Tool dispatcher        │
└─────────────────────────┘    │  + scope enforcer       │
                               └─────────────────────────┘
                                            │
                                            ▼
                               ┌─────────────────────────┐
                               │  QuickJS sandbox        │
                               │  + @cloudflare/codemode │
                               │  + pinakes bindings     │
                               └─────────────────────────┘
                                            │
                                            ▼
                               ┌─────────────────────────┐
                               │  Budget gate (truncate) │
                               └─────────────────────────┘
```

### 2.2 Tech stack (LOCKED — pin every version)

| Layer | Choice | Pin |
|---|---|---|
| Language | TypeScript 6 | `^6.0.0` |
| Runtime | Node 24 LTS | `^24.10.0` (pinned to `24.14.1` via `.nvmrc`) |
| MCP SDK | `@modelcontextprotocol/sdk` | `^1.29.0` (v2 pre-alpha too new; package name corrected in D29 — originally written as `@modelcontextprotocol/typescript-sdk`, which does not exist on npm) |
| Code-mode | vendored from `@cloudflare/codemode` 0.3.4 (MIT, Cloudflare Inc.) | 4 pure-JS helpers in `src/sandbox/vendored-codemode.ts` — dep removed per D30. `acorn ^8.16.0` added as a direct dep for `normalizeCode`. |
| Sandbox | `quickjs-emscripten` | `^0.29.0` |
| SQLite driver | `better-sqlite3` | `^12.8.0` (bumped from `^11.3.0` in D29 — 11.x lacks Node 24 prebuilds; 12.8.0 `engines` explicitly lists `24.x`) |
| SQLite binary | via better-sqlite3 | **3.50.4 OR 3.51.3+** (avoid FTS5 3.51.0 regression) |
| Vector index | `sqlite-vec` | `^0.1.9` (pre-v1 — expect breakage, have migration plan) |
| Schema mgmt | `drizzle-kit` + `drizzle-orm` | latest |
| Markdown parsing | `micromark` + `mdast-util-from-markdown` | latest |
| Embeddings (default) | `@xenova/transformers` + `Xenova/all-MiniLM-L6-v2-quantized` | `^2.17.0` |
| Embeddings (upgrade 1) | Ollama `nomic-embed-text` via HTTP | user-controlled |
| Embeddings (upgrade 2) | Voyage `voyage-code-3` via HTTPS | user-controlled |
| File watch | `chokidar` | `^4.0.0` |
| Logging | `pino` | `^9.x` |
| Testing | `vitest` | `^2.x` |
| Token counter | `js-tiktoken` (`p50k_base` encoder, 10% safety margin) | `^1.0.x` |

**Selection rationale**: matches Pharos's chosen stack where it exists (Drizzle, vitest, chokidar), uses Node ecosystem defaults elsewhere, and picks the structurally strongest sandbox (QuickJS: hard memory cap, no native deps).

**Version bumps (2026-04-08)**: Node 24 LTS replaces the original Node 20 pin — Pharos's `.nvmrc` is `24.14.1` and its workspace `engines` field is `"node": "^24.10.0"`, so Node 24 is the version that actually honors the "match Pharos" rationale above (see **D27**). TypeScript 6 replaces the `5.6+` pin — this is a conscious divergence from Pharos (`~5.9.3` across acp/desktop/text workspaces) to take the newer compiler; the dep-compat risk (drizzle-kit, MCP SDK peer deps) is gated on Phase 0 install verification, with a rollback path to `typescript ~5.9.3` recorded in **D28**.

### 2.3 Data architecture

**SQLite database**: `<projectDir>/.pinakes/pinakes.db`, plus `~/.pinakes/pinakes.db` for personal KG.

**Tables** (Drizzle schema; 8 total):
- `pinakes_nodes` — entity / section / concept / decision / log_entry / gap; deterministic id = sha1(scope + uri + section)
- `pinakes_edges` — src/dst + edge_kind (wikilink | cites | supersedes | contradicts | mentions | derived_from)
- `pinakes_chunks` — paragraph-level splits of nodes with token_count
- `pinakes_chunks_fts` — FTS5 virtual table over chunks (external content, `unicode61 remove_diacritics 2`, NOT trigram)
- `pinakes_chunks_vec` — sqlite-vec virtual table, `FLOAT[384]` (MiniLM dims; swappable)
- `pinakes_log` — append-only event log (materialized Karpathy log.md)
- `pinakes_gaps` — detected concept gaps with first_seen_at, mentions_count, resolved_at
- `pinakes_audit` — every tool call, for privacy invariant verification

Full DDL in the Loop 2 notes; extends Pharos's existing Drizzle schema via drizzle-kit migrations.

**Non-negotiable pragmas** (Loop 0 research):
```sql
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
PRAGMA cache_size = -20000;
PRAGMA temp_store = MEMORY;
```

**State machines**:
- Node: `proposed → extracted → (superseded | contradicted) → resolved`
- Gap: `detected → pending → (resolved | abandoned)`
- Ingestion: `idle → parsing → indexing → embedding → done | failed(retry)`

### 2.4 Service topology

One process, sub-components:
- MCP stdio server (protocol boundary)
- Tool dispatcher + scope enforcer (authz)
- **QuickJS warm pool (N=2)** + semaphore (was N=1; bumped for concurrent tool calls per Loop 6 gap G3)
- SQLite writer connection (single)
- SQLite read pool (2 connections)
- chokidar watcher
- Ingester (single-flight per source_uri)
- Embedder (shared model at startup)

### 2.5 API + integration

**External MCP surface**: exactly 2 tools, `search` + `execute`. Total schema footprint target <1500 tokens (cf. Cloudflare's 1K-token claim for 2500 endpoints).

**`search`**: fast path for simple lookups. Params: `query`, `scope` (project | personal | both, default project), `max_tokens` (default 5000, max 20000), `node_kinds` (optional filter).

**`execute`**: code-mode path. Params: `code` (JS string), `scope`, `max_tokens`, `timeout_ms` (default 2000, max 10000).

**Sandbox environment** (what the LLM writes against inside `execute`):

```typescript
declare const pinakes: {
  project: KGSide;
  personal?: KGSide;  // undefined unless scope includes 'personal'
  describe(): {
    project: { node_count: number; top_topics: string[]; last_updated: string };
    personal?: { node_count: number; top_topics: string[]; last_updated: string };
  };
};

interface KGSide {
  fts(query: string, opts?: { limit?: number; node_kinds?: string[] }): FtsHit[];
  vec(query: string, opts?: { limit?: number; node_kinds?: string[] }): VecHit[];
  hybrid(query: string, opts?: { limit?: number; rrf_k?: number; node_kinds?: string[] }): HybridHit[];
  get(id: string): Node | null;
  neighbors(id: string, opts?: { depth?: number; edge_kinds?: string[] }): Edge[];
  log: { recent(n: number, opts?: { kind?: string }): LogEntry[] };
  gaps(opts?: { resolved?: boolean; limit?: number }): Gap[];
}

declare const budget: {
  limit: number;
  used(): number;
  fit<T>(items: T[], toText: (t: T) => string): T[];
};
declare const logger: { log(msg: string): void };

// DISABLED: eval, Function, import, fetch, require, process, globalThis.constructor
```

**Response envelope** (both tools share):
```typescript
type KGResponse = {
  result: unknown;
  meta: {
    tokens_budgeted: number;
    tokens_used: number;
    results_truncated: boolean;
    scope: 'project' | 'personal' | 'both';
    query_time_ms: number;
    stale_files: string[];
  };
  logs?: string[];
};
```

**`IngestSource` adapter interface** (closes gap #13):
```typescript
interface IngestSource {
  start(onEvent: (ev: IngestEvent) => Promise<void>): Promise<void>;
  stop(): Promise<void>;
}
type IngestEvent = {
  kind: 'file:added' | 'file:changed' | 'file:removed';
  path: string;
  scope: 'project' | 'personal';
};
```
Two implementations: `ChokidarWatcher` (today + spike), `QueueSubscriber` (when orchestrator contract lands). Swap in 1 line.

### 2.6 Frontend

N/A — MCP server, not a UI.

### 2.7 AI/agent architecture

| Role | Model | Via | Fires |
|---|---|---|---|
| Primary caller | whatever Goose is configured for (claude-acp default) | caller, not us | per tool call |
| Gap-detection lint (v1) | Haiku 4.5 via claude-acp | Goose sub-agent | on-demand OR ≤1/hour background (rate-limited) |
| Embedder (default) | `Xenova/all-MiniLM-L6-v2-quantized` | `@xenova/transformers` in-process | ingest + query |
| Embedder (upgrade) | Ollama `nomic-embed-text` OR Voyage `voyage-code-3` | HTTP / HTTPS | if user configured |

Tool descriptions ARE the prompt. Target <1000 tokens combined.

### 2.8 Observability

- Structured JSON logs via pino to stderr (MCP spec allows stderr for logs)
- In-process metrics dumped on SIGHUP: `pinakes_queries_total`, `pinakes_query_latency_ms{p50,p95,p99}`, `pinakes_response_tokens`, `pinakes_budget_truncations_total`, `pinakes_sandbox_spawns_total`, `pinakes_sandbox_timeouts_total`, `pinakes_ingest_files_total`, `pinakes_stale_files_total`
- `pinakes_audit` table + `.pinakes/audit.jsonl` mirror
- No distributed tracing

### 2.9 Testing (≥80 tests total before MVP merge)

| Phase | Min tests |
|---|---|
| Schema / pragmas | 15 |
| Ingestion | 15 |
| MCP tool surface | 10 |
| Sandbox (includes 15-test adversarial privacy suite + disabled-global suite) | 20+ |
| Hybrid retrieval + budget gate | 10 |
| Integration end-to-end | 10 |

**Merge blockers**: all green + privacy adversarial suite 15/15 + budget adversarial suite (5 queries returning 100K tokens of text all truncated to ≤max_tokens).

### 2.10 Verification

| Check | Priority | Mechanism |
|---|---|---|
| Privacy invariant | **Must** | Dispatcher-level binding injection, 15 adversarial tests |
| Budget compliance | **Must** | Server-side final gate with 10% safety margin (js-tiktoken error headroom) |
| Staleness detection | Should | `file_sha` column + disk comparison on query |
| Prompt-injection hardening | **Must** | QuickJS runtime setup strips `eval`, `Function`, `import`, `fetch`, `require`, `process` |
| Sandbox escape | **Must** (ongoing) | Trust WASM boundary, monitor CVEs |
| Confidence filter | Should | LLM can filter by `confidence` column inside sandbox |

---

## Loop 3: Failure modes + cost

### 3.1 Failure modes (18 total, all with designed mitigations)

See conversation record for the full table. Highlights:

- **F1 (25K-cap breach)** → server-side final gate with 10% safety margin; never emits >cap.
- **F2 (privacy invariant leak)** → dispatcher-level injection; 15-test adversarial suite.
- **F3 (prompt injection via wiki content)** → sandbox denies code exec; provenance/confidence tags bound blast radius.
- **F4 (QuickJS CVE)** → pin + monitor; fallback plan to Deno subprocess sandbox.
- **F5 (chokidar missed event)** → reuse Pharos's 30-second sanity scan pattern from their eval-13.
- **F9 (sqlite-vec breaking change)** → schema version stamp in `pinakes_meta`; rebuild-from-markdown recovery.
- **F10 (SQLite corruption)** → markdown canonical; `pinakes rebuild` CLI recovers in ~30s.
- **F11 (infinite loop)** → QuickJS `shouldInterruptAfterDeadline` with `timeout_ms` param.
- **F12 (sandbox OOM)** → QuickJS `setMemoryLimit(64 * 1024 * 1024)` — hard WASM cap.
- **F17 (graph explosion)** → per-file node cap (500) with configurable override.

### 3.2 Security

- AuthN/AuthZ inherited from Pharos/Goose (user's local machine).
- Prompt injection prevention: layered (sandbox + confidence + tool description warnings).
- Embedder API data leakage: per-KG opt-in, never silent.
- API keys: env-only, never stored in our config.
- Audit log: every tool call.

### 3.3 Performance

- FTS5 external content table (no duplicate storage).
- Vector brute force up to ~50K chunks at 384 dims.
- Warm sandbox pool N=2 + semaphore; cold fallback.
- Embedder model loaded once at startup (~800ms).
- 20MB SQLite page cache.

### 3.4 Cost

| Scale | Users | Embedding cost | LLM cost (lint) |
|---|---|---|---|
| Spike | 1 | $0 | $0 |
| MVP | 100 | $0 default | $0 to us (user's Max quota via claude-acp) |
| v1 scale | 1000 | $0 default, ~$0.07/reindex if user configures OpenAI | $0 to us |

Worst-case single-user cost with paid embedding: ~$2/month. Realistic: $0.

### 3.5 Risks & limitations

**Explicitly not building**: tree-sitter code parsing (v1), multi-language symbols (v1), wiki *writing* (Pharos owns), graph algorithms (possible v1), multi-user/server (local-only).

**Assumptions**:
1. Pharos ships the wiki-updater in POC Phase 4 (if slipped, we dogfood with hand-written markdown)
2. Claude Code keeps the 25K cap (if raised, our design still works, urgency drops)
3. MiniLM-L6-v2 is "good enough" (if hit rate <70%, fall through to Ollama nomic)
4. sqlite-vec v0.1.9 has no blocking bug (if it does, FTS5-only fallback)

**Biggest technical risk**: QuickJS warm-pool cold-start perf. If >200ms, p95 target breaks. Measured in Phase 1 spike.

**Fallback**: drop code-mode, ship classic fine-grained tools (`pinakes_fts`, `pinakes_vec`, `pinakes_get`, `pinakes_neighbors`), accept the token cost, add code-mode in MVP+1.

---

## Loop 4: Phased implementation plan

Summary — see `PRD.md` for the detailed breakdown with acceptance criteria and test counts.

| Phase | Goal | Effort | Deps |
|---|---|---|---|
| 0 | Scaffold + prior art study | ½ day | — |
| 1 | **Spike (TODAY)** — stdio MCP + minimal search + execute + QuickJS + budget gate | ½-1 day | P0 |
| 2 | Persistence + ingestion (full schema, chokidar, idempotent upsert) | 1-2 days | P1 |
| 3 | Sandbox + code-mode bindings (full env, adversarial hardening) | 2 days | P2 |
| 4 | Hybrid retrieval + budget gate (FTS5 + vec + RRF, server-side truncation) | 2 days | P3 |
| 5 | Personal KG + privacy invariant enforcement | 1 day | P4 |
| 6 | Provenance + read-only gap detection | 1 day | P5 |
| 7 | Polish, testing, observability (80+ tests green) | 1 day | P6 |
| 8 | **v1 stretch** — gap-fill writer loop, time-travel, tree-sitter | unscoped | P7 |

---

## Loop 6: Gap analysis results

**11 gaps found, 10 patched, 1 scoped to external coordination.**

### Requirements trace: 21/21 addressed

- 19 at High confidence
- 2 at Medium confidence (R2/R3 = gap-fill writer loop deferred to v1; R7/R18 = Goose registration and orchestrator queue contract need external verification)

### Patches applied

| # | Gap | Fix | Phase |
|---|---|---|---|
| P1 | G1: wiki-updater coordination on proposals file | Append-only `.jsonl`; coordinate with Pharos team before enabling | P6 |
| P2 | G2: token-count estimation error | 10% safety margin — `internal_budget = floor(max_tokens * 0.9)` | P4 |
| P3 | G3: concurrent tool calls | Warm pool N=2 + semaphore | P3 |
| P4 | G4: sandbox crash recovery | Catch → dispose → respawn → structured error | P3 |
| P5 | G6: no backup/export/purge | `pinakes purge | export | import` CLI | P7 |
| P6 | G7: single-upstream code-mode dep | Document vendoring fallback | CLAUDE.md |
| P7 | G11: Goose registration unverified | Phase 1 acceptance includes both `claude mcp add` and Goose-native | P1 |
| P8 | G10: embedder quality unproven | Phase 4 exit criterion: hit rate ≥70% on fixture; fallback to Ollama nomic | P4 |
| P9 | G5: cross-scope leakage | Tag every result with `source_scope`; document tradeoff | CLAUDE.md |
| P10 | G8: no LLM write path | Document design decision; LLM-initiated writes go via Pharos wiki-updater | CLAUDE.md |

### Decision confidence

| Decision | Confidence | Risk if wrong | Reversibility |
|---|---|---|---|
| SQLite + better-sqlite3 | High | — | Easy |
| QuickJS sandbox | Medium-High | Perf cold-start | Medium (swap Executor class) |
| `@cloudflare/codemode` reuse | Medium | Hidden Cloudflare assumptions | Medium (vendor + fork) |
| MCP SDK `^1.29.0` | High | v2 pre-alpha | Easy |
| Bundled transformers.js default | Medium | Hit rate threshold | Easy (fall through to Ollama) |
| `sqlite-vec` pre-v1 | Medium | Breaking change | Medium (rebuild from markdown) |
| Markdown canonical, SQLite index | High | — | — |
| 2-tool code-mode surface | High | Awkward LLM code for simple queries | Low (add fine-grained in MVP+1) |

---

## Decision log (chronological)

| # | Decision | Locked at | Source |
|---|---|---|---|
| D1 | MCP consumer = coding LLM directly (not Pharos's internal orchestrator) | User Q&A 1 | Loop 1 §1.1 |
| D2 | Full code-mode pattern (search + execute) | User Q&A 2 | Loop 1 §1.1 |
| D3 | Personal + Project KGs isolated, LLM-driven bridge | User Q&A 3 | Loop 1 §1.5, Loop 2 §2.5 |
| D4 | Ingest from orchestrator queue (TBD) with chokidar stub | User Q&A 4 | Loop 2 §2.5 (IngestSource) |
| D5 | Feasibility spike required TODAY | User Q&A "timeline" | Loop 1 §1.4, Loop 4 P1 |
| D6 | Local-default embeddings, config for API upgrades | User Q&A "embeddings" | Loop 1 §1.3, Loop 2 §2.7 |
| D7 | ~~Pharos is the parent app; Pinakes is the v1 wiki-query layer~~ **Superseded by D35** — now standalone | Reading Pharos PRESEARCH.md | Preamble |
| D8 | Markdown canonical, SQLite index | Loop 0 + design judgment | Loop 2 §2.3 |
| D9 | QuickJS sandbox (vs isolated-vm) | Loop 0 research + self-critique | Loop 2 §2.2 |
| D10 | Reuse `@cloudflare/codemode` Executor interface | Loop 0 research | Loop 2 §2.2 |
| D11 | Response budget gate server-side with 10% safety margin | Loop 6 patch P2 | Loop 2 §2.10 |
| D12 | Warm sandbox pool N=2 + semaphore | Loop 6 patch P3 | Loop 2 §2.4 |
| D13 | Bundled transformers.js default; Ollama/Voyage upgrade path | Loop 1 self-critique | Loop 2 §2.7 |
| D14 | 2-tool MCP surface (`search` + `execute`) | Loop 2 | Loop 2 §2.5 |
| D15 | `scope` param on every tool call; `pinakes.personal` binding dispatcher-gated | Loop 2 | Loop 2 §2.5, §2.10 |
| D16 | 5 CORE innovations, 2 STRETCH after self-critique | Loop 1.5 self-critique | Loop 1.5 |
| D17 | MVP has read-only gap detection; writer loop is v1 | Loop 6 R2/R3 Medium confidence | Loop 4 P6/P8 |
| D18 | Pin SQLite 3.50.4 OR 3.51.3+ (FTS5 regression) | Loop 0 research | Loop 2 §2.2 |
| D19 | `IngestSource` interface to decouple chokidar vs future queue | Loop 2 Mini gap check #1 | Loop 2 §2.5 |

## Open questions (for Pharos team coordination)

| # | Question | Blocker for |
|---|---|---|
| OQ1 | MCP client registration flow — `claude mcp add`, Goose config, Cursor MCP config, etc. | Phase 7 (docs) |
| OQ2 | Optional orchestrator message-queue integration (e.g. Pharos Redis pub/sub) | Optional — ChokidarWatcher is sufficient for standalone |
| ~~OQ3~~ | ~~Wiki updater proposals file protocol~~ | **Dissolved by D35** — write path is self-contained |
| ~~OQ4~~ | ~~Extend pharos.db or separate file?~~ | **Dissolved by D35** — standalone `.pinakes/pinakes.db` |
| ~~OQ5~~ | ~~Pharos settings UI for API keys~~ | **Dissolved by D35** — env vars only, client-agnostic |

---

## Loop 6.5: Late Challenger amendment (post-artifact)

**Context**: after Loops 1-6 were locked and the initial artifacts written, the Challenger teammate's response arrived late (having been processed after the shutdown request was issued). Its critique surfaced **seven legitimate gaps** that my solo self-review missed or under-specified. All patches below are applied to this document and `CLAUDE.md` / `PRD.md`. This amendment is preserved for honest decision-log traceability.

### A1 — Audit log privacy leak (CRITICAL)

**Original**: single `.pinakes/audit.jsonl` mirror for all scopes.

**Problem**: `.pinakes/audit.jsonl` lives inside the user's project repo. A query with `scope='personal'` logs the query text + snippet into a path that `git add .` commits. **This is a privacy leak that would ship.**

**Patch (applied to §2.8, §3.2, and CLAUDE.md)**:
- **Split audit mirrors by scope**:
  - `scope='project'` → `.pinakes/audit.jsonl` (repo-local, safe to commit)
  - `scope='personal'` OR `scope='both'` → `~/.pinakes/audit.jsonl` (home dir only)
- **Split SQLite audit tables too**: `pinakes_audit` in `pinakes.db` is project-scoped; personal-scope rows go to `pinakes_audit` in `~/.pinakes/pinakes.db`. Never mix.
- Merge-blocker test: a `scope='personal'` call must leave zero bytes in `.pinakes/audit.jsonl` and must append to `~/.pinakes/audit.jsonl`.

### A2 — Personal KG unbounded at cross-project scale (CRITICAL)

**Original**: Scale table projected 2K personal chunks at v1, treating it as linear with project usage.

**Problem**: personal KG accumulates across **every repo the developer ever touches**. At a realistic cadence of 5-10 new observations per session × 200+ sessions/year, 50K chunks arrive within months, not years. Brute-force sqlite-vec at 1024-dim hits ~200ms/query at 50K vectors before FTS5, RRF, or snippet cost. Latency budget breaks.

**Patch (applied to §1.2, §2.3, and PRD.md Phase 5)**:
- **Hard cap personal KG at 5,000 chunks** with LRU eviction on `last_accessed_at`.
- Add `last_accessed_at INTEGER NOT NULL` to `pinakes_nodes`; bump on every read that returns that node.
- On personal-KG ingest, if chunk count >5000 after insert, evict the oldest-accessed nodes (cascades to chunks/edges/vectors) until under cap.
- Project KG has no cap — it's bounded by the repo's wiki files.
- Eviction logged to `pinakes_log` for audit.

**Alternative considered and rejected**: topic partitioning (per-language/framework shards). Added complexity for marginal win at our scale; revisit in v1 if LRU eviction produces observable quality loss.

### A3 — Budget math doesn't work at max_tokens=5000

**Original**: "10% safety margin; `internal_budget = floor(max_tokens * 0.9)`" = 4500 at max 5000.

**Problem**: a single result with `{title, source_uri, confidence, source_scope, body_snippet}` can easily be 300+ tokens. 15 results × 333 = 4995, zero room for the `meta` envelope fields (`tokens_used`, `query_time_ms`, `stale_files`, etc.). Real responses either underflow or overflow.

**Patch (applied to §2.5, §2.10, PRD.md Phase 4, and CLAUDE.md API Rules)**:
- New math:
  - `envelope_reserve = 500` tokens
  - `safety_margin = 0.9`
  - `available_for_results = floor((max_tokens - envelope_reserve) * safety_margin)`
  - At `max_tokens=5000`: `available = floor(4500 * 0.9) = 4050` tokens for result bodies
- **Greedy RRF-rank truncation**: keep the top-ranked result whole if it fits; iterate down the ranked list; stop when the next result doesn't fit.
- **`too_large` sentinel**: if even the top-1 result alone overflows the available budget, return `{ result: { too_large: true, id, source_uri, preview: first_200_chars, full_token_count }, meta: {...} }`. The LLM can re-query with higher `max_tokens` or directly `pinakes.project.get(id)` from inside a follow-up `execute`.
- Adversarial tests (PRD Phase 4): 1 huge node, 100 small nodes, 1 huge + 99 small, all must comply under max_tokens=5000.

### A4 — Ingest cascading reindex on wiki-updater rewrites

**Original**: My revised throughput was ~0.13 files/s bounded by embedding, with SHA-dedup on unchanged files.

**Problem**: Pharos's wiki-updater (per eval-14) **rewrites whole files per turn** — every turn re-emits the full architecture.md, etc. File-level SHA-dedup fires on every turn because the file changed. Result: 6 files × ~10 chunks each × ~50ms embedding = ~3 seconds of blocking work per turn, competing with the active coding LLM for the same Ollama instance.

**Patch (applied to §2.3, §3.1 F6, PRD.md Phase 2, CLAUDE.md Database Rules)**:
- **Per-chunk content hash, not per-file.** Add `chunk_sha TEXT NOT NULL` to `pinakes_chunks`. On re-ingest of a whole file, compute `chunk_sha` for each new chunk; only re-embed if the sha changed. In practice, the wiki-updater adds one paragraph per turn — so only 1 of ~10 chunks needs re-embedding, not all of them.
- **Chokidar debounce: 2 seconds**, not default 50ms. Atomic rename + `log.md` append produce cascading events within milliseconds; 2s coalesces them.
- **Bounded queue with drop-oldest** per `source_uri`: if 3 rewrites of `architecture.md` queue up before any ingest runs, drop the first 2 and ingest only the latest.

### A5 — Sandbox cold-start budget hole

**Original**: "Warm pool N=2 solves cold start."

**Problem**: N=2 handles concurrency but says nothing about the COLD case. `quickjs-emscripten` module instantiation is ~20-60ms cold on Node. The spike could measure p50 cold-start at 100ms+, blowing the <50ms p50 budget before a single DB query runs.

**Patch (applied to PRD.md Phase 1 acceptance, §Loop 3 risk)**:
- **Phase 1 spike acceptance criterion #9 (new)**: measure and record `execute` cold-start latency. Target: <150ms p50. If >150ms:
  - **Fallback path**: swap QuickJS executor for `isolated-vm` in Phase 3. Accept soft memory limit (2-3× enforced bypass possible) and host OOM risk (`setMemoryLimit` is a guideline not a wall). Mitigation: single-user local tool; isolate crash = MCP restart.
- Update §Loop 3 risk table: "sandbox cold-start perf" raised to **High severity with a concrete fallback** instead of being hand-waved as "can be addressed."

### A6 — SQLite + sqlite-vec crash recovery

**Original**: F10 says "markdown canonical, `pinakes rebuild` recovers in ~30s."

**Problem**: sqlite-vec is pre-v1. Its crash-recovery behavior during half-written virtual table updates is untested. A corrupt vec table during ingest could silently return bad distances for weeks.

**Patch (applied to §3.1 F10, CLAUDE.md Database Rules)**:
- **`manifest.json`** consistency file:
  - Project scope: `.pinakes/manifest.json`
  - Personal scope: `~/.pinakes/manifest.json`
- Format: `{ files: { <file_path>: { source_sha, chunk_shas: string[] } } }`
- Written atomically at the end of every successful ingest transaction
- On MCP startup, consistency check: for each file in the manifest, compute current `source_sha`. If mismatch, enqueue a rebuild for that file. Covers the case where the process crashed mid-ingest and the SQLite tables have partial state.

### A7 — Innovation list still inflated

**Original**: My self-cut was 12 → 7 CORE/STRETCH. Challenger argues the cut was still too generous.

**Re-cut (applied to §Loop 1.5, PRD.md innovation tracking)**:

| # | Original classification | Challenger verdict | Final classification |
|---|---|---|---|
| A (code-mode API) | CORE innovation | CORE innovation | **CORE innovation** |
| B (budget-shaped response) | CORE innovation | Table stakes — "alternative is a broken product" | **CORE baseline (not innovation)** |
| C (structural privacy binding) | CORE innovation | CORE innovation | **CORE innovation** |
| D (provenance tags) | CORE innovation | CORE baseline, Medium impact | **CORE baseline (not innovation)** |
| E (gap detection, read-only) | CORE innovation | — (not challenged) | **CORE innovation** |
| Cross-KG discovery (had demoted) | Table stakes | "Under-specified" — describe() schema must be tight | **CORE innovation (re-promoted after sharpening)** — `describe()` must return `{node_count, top_tags, last_updated}` per scope, nothing else |
| F (time-travel) | STRETCH innovation | **Cut entirely** — depends on Pharos-owned log format we don't control | **Cut** |
| G (personal KG skill observations) | STRETCH innovation | — (not challenged) | **STRETCH innovation** |
| **NEW: H (contradiction detector)** | — | Proposed as STRETCH; pairwise LLM judge over chunks with opposing claims; genuinely novel vs obra/knowledge-graph and basic-memory; cheap as nightly run | **STRETCH innovation (added)** |

**Final innovation count: 4 CORE + 2 STRETCH = 6.**
- **CORE**: A (code-mode API), C (structural privacy), E (gap detection read-only), Cross-KG `describe()`
- **STRETCH**: G (personal KG skill observations), H (contradiction detector)
- **Baselines (not innovations, still in MVP)**: B (budget-shaping), D (provenance tags)
- **Cut**: F (time-travel)

### A8 — Updated Loop 1 scale table

| Metric | Spike (today) | MVP | v1 target | Notes |
|---|---|---|---|---|
| Project chunks | ~60 | ~500 | ~8,000 | unbounded by repo size |
| **Personal chunks** | 0 | ≤1,000 (natural) | **≤5,000 (LRU hard cap)** | per A2 |
| Query p50 | <50 ms | <100 ms | <150 ms | assumes warm pool + A5 benchmark passes |
| Query p95 | <200 ms | <500 ms | <1 s | |
| Ingest (cold full rebuild) | n/a | <15s | <60s | per A4 chunk-level dedup |
| Ingest (incremental, wiki-updater rewrite) | <500ms | <500ms | <500ms | per A4 per-chunk hash skip |

### A9 — Decision log additions

| D# | Decision | Source |
|---|---|---|
| D20 | Split audit JSONL + SQLite tables by scope to prevent git-repo leakage | Loop 6.5 A1 |
| D21 | Personal KG hard-capped at 5K chunks with LRU eviction on `last_accessed_at` | Loop 6.5 A2 |
| D22 | Budget math: `available = floor((max - 500) * 0.9)`; greedy RRF truncation; `too_large` sentinel for single-oversize | Loop 6.5 A3 |
| D23 | Per-chunk content hash (not per-file) + 2s chokidar debounce + bounded drop-oldest queue | Loop 6.5 A4 |
| D24 | Phase 1 spike acceptance adds sandbox cold-start benchmark gate (<150ms p50) with isolated-vm fallback path | Loop 6.5 A5 |
| D25 | `.pinakes/manifest.json` + `~/.pinakes/manifest.json` for startup consistency check against pre-v1 sqlite-vec crash recovery | Loop 6.5 A6 |
| D26 | Innovation final cut: 4 CORE + 2 STRETCH + 2 baselines. Time-travel cut. Contradiction detector added. | Loop 6.5 A7 |
| D27 | Bump Node runtime pin from 20 LTS to 24 LTS (`^24.10.0`, `.nvmrc 24.14.1`) | Pharos `.nvmrc`=24.14.1 + `engines: ^24.10.0` — original rationale was "match Pharos where it exists", which the Node 20 pin no longer did (§2.2) |
| D28 | Adopt TypeScript 6 (diverges from Pharos `~5.9.3`) | User directive 2026-04-08; compiler-feature benefit accepted over dep-compat risk; rollback to `~5.9.3` if drizzle-kit/MCP SDK peer deps reject TS 6 in Phase 0 install (§2.2) |
| D29 | Dep-pin corrections discovered during Phase 0 install: (a) MCP SDK package is `@modelcontextprotocol/sdk`, not `@modelcontextprotocol/typescript-sdk` (the latter doesn't exist on npm); (b) `better-sqlite3` bumped `^11.3.0` → `^12.8.0` because 11.x lacks Node 24 prebuilds and 12.8.0 `engines` explicitly lists `24.x`. SQLite-binary rule unchanged (`3.50.4` OR `≥3.51.3`, never `3.51.0`) — the 12.8.0 bundled SQLite is 3.51.3, verified via smoke test in Phase 0. | Phase 0 install verification 2026-04-08 |
| D30 | Vendor the 4 pure-JS helpers from `@cloudflare/codemode` into `src/sandbox/vendored-codemode.ts` (MIT-attributed). Drop the `@cloudflare/codemode` dep entirely. Add `acorn ^8.16.0` as a direct dep (needed by `normalizeCode`) and `@types/json-schema ^7.0.15` as a direct devDep. Drives from D10 — the "Reuse `@cloudflare/codemode` Executor interface" decision — but promotes the presearch.md §2.2 "vendoring fallback" from fallback to primary path because the package's main entry imports `RpcTarget from "cloudflare:workers"` and is unusable from Node. Vendored file is ~557 LOC (over the loose 400 LOC budget, but comments/types/blank lines are ~half of that; executable statements <300). We write our own QuickJS-backed `Executor` implementation instead of adapting `DynamicWorkerExecutor`. Full audit in `dev-docs/prior-art.md §5`. | Phase 0 install + user directive 2026-04-08 |
| D31 | QuickJS 0.32.0 promise unwrap path: use the **synchronous** `context.getPromiseState(handle)` after draining the pending-jobs queue, NOT `context.resolvePromise(...)`. Reasoning: all Phase 1 host bindings (`pinakes.search`, `pinakes.get`) are sync, so the async IIFE emitted by `normalizeCode` has no real async work — its Promise settles entirely inside the VM during `runtime.executePendingJobs()`. Bridging through `resolvePromise` (which returns a host-side JS Promise) hangs the event loop because there's nothing on the host side to resolve the bridge. Also: every handle returned by `getPromiseState` (both `state.value` when fulfilled and `state.error` when rejected) must be explicitly `.dispose()`d before disposing the runtime, or QuickJS asserts `list_empty(&rt->gc_obj_list)` and crashes the WASM module. Phase 3's warm pool must preserve both invariants. See `src/sandbox/executor.ts:execute()`. | Phase 1 spike implementation 2026-04-08 |
| D32 | `js-tiktoken p50k_base` has **O(n²) BPE merge complexity on long repeated-character runs** (60K chars → 200s on M3 macOS, measured). This is a DoS vector on the budget gate — a user `execute` call that returns a large string would block the event loop for minutes before the gate rejects it. Mitigation: `countTokens(text)` in `src/gate/budget.ts` short-circuits to a conservative character-based estimate (`ceil(text.length / 3.0)`) when `text.length > EXACT_TOKENIZE_MAX_CHARS` (currently 8000). The estimate always over-counts (real English is 4+ chars/token), so the budget gate stays safe at worst by truncating a few extra responses. Short strings (normal envelopes under ~2000 tokens) still use the exact tokenizer. This is a production invariant, not a test-only fix — any replacement tokenizer in the future must either be O(n) or preserve the length threshold. | Phase 1 spike test run 2026-04-08 |
| D33 | Phase 1 cold-start benchmark gate (D24) **passed decisively**: p50 = **0.38ms**, p95 = **0.68ms** over 20 runs with a fresh `QuickJSRuntime + QuickJSContext` per call on `quickjs-emscripten@0.32.0` + Node 24.14.1 + macOS arm64. Budget was 150ms p50. **QuickJS is locked as the sandbox for all subsequent phases; the `isolated-vm` fallback path referenced in D24 is dropped from planning and does not need to be implemented.** Warm-pool work in Phase 3 is still worth doing for concurrent-call throughput, not for per-call latency — there's no latency budget pressure at this scale. | Phase 1 acceptance gate 2026-04-08 |
| D34 | Use the high-level `McpServer.registerTool(name, config, cb)` API from `@modelcontextprotocol/sdk@1.29.0`, not the low-level `Server.setRequestHandler(ListToolsRequestSchema, ...)` + `CallToolRequestSchema` path the original presearch assumed. The low-level API is deprecated in 1.29.0 (all `tool()` overloads marked `@deprecated Use registerTool instead`). `config.inputSchema` is a zod **raw shape** (`{ field: z.string(), ... }`), not a compiled schema — the SDK compiles it internally. Handlers return `{ content: [{ type: 'text', text }], isError?: boolean }`, with our envelope JSON-stringified into the single text block. This matters for Phase 3's full code-mode tool surface and any future additions. See `src/spike.ts:buildSpikeServer()` and `src/mcp/tools/{search,execute}.ts`. | Phase 1 spike implementation 2026-04-08 |
| D35 | **Standalone self-sufficient MCP**: owns full read/write/index/query/gap-detect/gap-fill lifecycle. Write path via `pinakes.project.write(path, content)` binding inside `execute` — writes markdown to disk (atomic rename), chokidar triggers re-indexing. Path convention moves from `.pharos/` to `.pinakes/`. Pharos compatibility preserved via `--wiki-path` flag. Removes dependency on external wiki-updater for writes. Gap detection becomes a closed loop (detect → surface → write → re-index → resolved) without external coordination. Supersedes D7. Safety constraints: path containment to wiki root, `.md` extension only, 100KB max per write, 20 writes per `execute` call, audit-logged. | User directive 2026-04-09 |
| D36 | **LLM provider factory** (`src/llm/provider.ts`): tiered cascade for lightweight completions — MCP sampling → Ollama → API key (Anthropic/OpenAI via fetch) → `claude -p` subprocess → `codex exec` subprocess → disabled. No new deps. CLI subprocesses deprioritized as they run full agent loops with 2-5s overhead; Goose team abandoned this pattern (block/goose#5593). MCP sampling is future-proof (SDK ready, Claude Code anthropics/claude-code#1785 pending). | Phase 8, GBrain analysis 2026-04-11 |
| D37 | **Post-RRF 3-layer dedup** (`src/retrieval/dedup.ts`): Layer 1 caps at 3 chunks/source_uri, Layer 2 drops Jaccard bigram similarity >0.85, Layer 3 final cap at 2 chunks/source_uri. Runs after RRF fusion, before budget gate. Increases result diversity. Inspired by GBrain's 4-layer pipeline (we skip their type-diversity layer since nodes are untyped). | Phase 8, GBrain analysis 2026-04-11 |
| D38 | **Multi-query expansion** opt-in via `expand: boolean` on `search`. Uses LLM provider (D36) to generate 2 alternative phrasings, runs hybrid search 3x, merges via `rrfFuseMulti`. Exception to D1 "no LLM on query path" — explicitly opt-in, non-fatal fallback. Queries <3 words skip expansion (adds noise). Module-level cache (100 entries). | Phase 8, GBrain analysis 2026-04-11 |
| D39 | **Wikilink edge extraction** during ingest populates `pinakes_edges`. Regex reused from `src/gaps/detector.ts`. Resolves `[[term]]` to node IDs by matching source_uri basename or title (case-insensitive). Unresolved links silently skipped. Idempotent: old edges deleted before re-insert. Prerequisite for graph algorithms (D40). | Phase 8 stretch 2026-04-11 |
| D40 | **PageRank + connected components** as `execute` sandbox bindings (`pinakes.project.pagerank()`, `pinakes.project.components()`). Pure JS implementations over SQL-loaded adjacency data. PageRank: iterative power method (d=0.85, 20 iters). Components: BFS on undirected edges. No new deps. | Phase 8 stretch 2026-04-11 |

---

## Sources

See `dev-docs/research-brief.md` for the full 85+ URL inventory from Loop 0. Key pointers:

- **Pharos docs** (optional, for Pharos extension deployments): `~/dev/gauntlet/pharos/docs/PRESEARCH.md`, `ARCHITECTURE.md`
- **Code-mode**: [blog.cloudflare.com/code-mode](https://blog.cloudflare.com/code-mode/), [code-mode-mcp](https://blog.cloudflare.com/code-mode-mcp/), [cloudflare/agents code-mode package](https://github.com/cloudflare/agents/tree/main/packages/codemode), [jx-codes/codemode-mcp](https://github.com/jx-codes/codemode-mcp)
- **Prior art**: [obra/knowledge-graph](https://github.com/obra/knowledge-graph), [tobi/qmd](https://github.com/tobi/qmd), [basicmachines-co/basic-memory](https://github.com/basicmachines-co/basic-memory)
- **Karpathy**: [gist](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)
- **SQLite**: [sqlite.org/fts5](https://www.sqlite.org/fts5.html), [sqlite-vec](https://github.com/asg017/sqlite-vec), [Alex Garcia hybrid RRF blog](https://alexgarcia.xyz/blog/2024/sqlite-vec-hybrid-search/)
- **Claude Code 25K cap**: [community discussion 169224](https://github.com/orgs/community/discussions/169224)
- **MCP spec**: [2025-11-25 changelog](https://modelcontextprotocol.io/specification/2025-11-25/changelog), [typescript-sdk](https://github.com/modelcontextprotocol/typescript-sdk)
