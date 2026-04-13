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

## Loop 8: audit-wiki v2 — Feature Redesign (2026-04-11)

> **Context**: The `audit-wiki` CLI command (Phase 8 stretch H) shipped with three subsystems — contradiction detection, gap detection, and stub page generation — that all underperform in production. This amendment redesigns all three, plus adds progress feedback. The existing LLM provider factory (D36) and CLI infrastructure are reused.
>
> **Team**: Architect (proposes), Challenger (attacks), Researcher (validates with evidence). All Opus 4.6.
>
> **Mode**: FEATURE MODE — Loop 0 (research) -> Loop 2 (architecture) -> Loop 4 (plan) -> Loop 6 (gap check).

### Loop 0: Research Brief

#### Problem inventory (measured on the Pharos wiki — 18 files, ~6000 chunks)

| # | Subsystem | Current behavior | Measured result | Root cause |
|---|---|---|---|---|
| P1 | Contradiction detection | Pairwise LLM judge on 50 pairs selected by vector cosine <= 0.3 | 0 contradictions found on a wiki with known inconsistencies | (a) cosine <= 0.3 filters to near-identical chunks, not contradictory ones; (b) 50 pairs is a tiny sample; (c) same-source pairs skipped, but contradictions often live within the same conceptual domain across files |
| P2 | Gap detection | Regex extraction of bold/wikilink/backtick terms, count mentions, flag >= 3 mentions with no page | 1218 "gaps" (391 "significant") — noise like "description", "command", "instead", "window", "default" | Purely syntactic; no semantic understanding of what constitutes a real topic vs. a common word |
| P3 | Stub generation | LLM generates placeholder with questions | Empty shells with "What is X? How does X relate to Y?" | No synthesis from existing content; creates noise that gets indexed |
| P4 | UX | `console.log("Scanning...")` then silence for up to 50 min | Zero progress for potentially 50 sequential LLM calls | No streaming, no phase indicators, no progress counters |

#### Research findings

**Contradiction detection approaches** (from literature review):

| Approach | How it works | Pros | Cons | Source |
|---|---|---|---|---|
| **Pairwise LLM judge** (current) | Pick chunk pairs by similarity, ask LLM "do these contradict?" | Simple prompt | O(n^2) pairs, similarity threshold misses cross-domain contradictions, 50-pair ceiling too small | Current implementation |
| **Assertion extraction + fact table** | LLM extracts structured claims (subject, predicate, object) from each chunk, then compares claims sharing the same subject | Focuses on factual claims; scales to whole wiki in 1 pass; claim table is reusable | Extraction quality depends on LLM; needs schema for claims | [Stanford NLP contradiction detection](https://nlp.stanford.edu/pubs/contradiction-acl08.pdf), [Springer formal logic + LLM](https://link.springer.com/article/10.1007/s10515-024-00452-x) |
| **Topic-clustered summarization** | Cluster chunks by topic, generate per-topic summary, then compare summaries | Reduces N from "all pairs" to "all topics"; catches cross-file contradictions | Still needs LLM for clustering; may merge distinct topics | [datarootsio/knowledgebase_guardian](https://github.com/datarootsio/knowledgebase_guardian) |
| **RAG contradiction validators** | On every retrieval, check if returned docs contradict each other | Real-time; catches live contradictions | Query-path latency cost; only finds contradictions relevant to current query | [arxiv 2504.00180](https://arxiv.org/abs/2504.00180) |
| **NLI-based classification** | Use an NLI model (entailment/contradiction/neutral) on chunk pairs | Fast; no LLM call per pair | NLI models are weak on domain-specific technical content; miss implicit contradictions | [ACL 2025 findings](https://aclanthology.org/2025.findings-acl.1305.pdf) |

**Gap detection approaches**:

| Approach | How it works | Pros | Cons |
|---|---|---|---|
| **Syntactic extraction** (current) | Regex for bold/wikilink/backtick, count mentions | Zero LLM cost | Extracts noise; no semantic understanding |
| **LLM-assisted topic extraction** | LLM reads each file, extracts key topics/concepts | Understands semantics | LLM call per file; expensive at scale |
| **Hybrid: syntactic extraction + LLM filter** | Extract candidates syntactically, then batch-filter with LLM | Best of both: cheap extraction + smart filtering | One additional LLM call (batched) |
| **Embedding cluster analysis** | Cluster chunk embeddings, identify orphan clusters | Finds implicit gaps | Hard to name what's missing |
| **Graph topology analysis** | Find nodes with high in-degree (many references) but no dedicated page | Uses existing edge data | Only works if wikilinks are maintained |

**Stub generation approaches**:

| Approach | How it works | Pros | Cons |
|---|---|---|---|
| **Placeholder stubs** (current) | LLM generates "What is X?" template | Simple | Noise; no real content |
| **Synthesis stubs** | Gather all mentions of the gap topic, LLM synthesizes a draft page from existing context | Real content from day 1 | More LLM calls; synthesis quality varies |
| **Report-only (no stubs)** | Produce an actionable report but don't create files | No noise; human decides | Gaps not auto-filled |
| **Draft + review gate** | LLM synthesizes draft, writes to `_drafts/` not wiki root, human or LLM reviews before promotion | Quality gate; no noise in main wiki | Extra step; needs draft promotion flow |

### Loop 2: Architecture Decisions (with debate)

#### D41 — Contradiction detection: Topic-clustered assertion extraction

**Architect proposes**: Replace the pairwise LLM judge with a two-phase pipeline:

- **Phase A (Assertion Extraction)**: For each wiki file, send the full content to the LLM with a structured extraction prompt. The LLM returns a JSON array of claims: `{ subject: string, predicate: string, object: string, source_uri: string, chunk_id: string }`. One LLM call per file (~18 calls for Pharos wiki). Store claims in a new `pinakes_claims` table.
- **Phase B (Claim Comparison)**: Group claims by normalized subject. For each subject with 2+ claims from different source files, send the claim group to the LLM as a single batch: "Do any of these claims about [subject] contradict each other?" One LLM call per subject group (estimated 10-30 groups for a typical wiki).

Total LLM calls: ~20-50 (vs. 50 pairwise calls), but each call is more productive because it compares semantically related claims, not random pairs.

**Challenger attacks**: "Assertion extraction is fragile. LLMs extract differently on each run. Your claim table will be noisy — `{subject: 'auth', predicate: 'uses', object: 'bcrypt'}` vs `{subject: 'authentication', predicate: 'implemented with', object: 'bcrypt hashing'}`. How do you normalize subjects for grouping? You've moved the hard problem from 'find contradictions' to 'normalize extracted claims', which is equally hard."

**Architect responds**: Fair. Pure triple extraction is over-structured for our wiki's prose-heavy content. **Revised proposal**: drop the rigid (S, P, O) schema. Instead:

- **Phase A (Topic-Claim Extraction)**: LLM reads each file and returns `{ topic: string, claims: string[] }[]` — a list of topics discussed in this file, each with the natural-language claims made about that topic. Topic normalization is the LLM's job during extraction (prompt instructs: "Use the most common/canonical name for each topic, e.g. 'authentication' not 'auth flow'").
- **Phase B (Cross-File Comparison)**: Group by topic (case-insensitive match). For each topic with claims from 2+ files, send the full claim set to the LLM: "Here are all claims about [topic] from different wiki files. Identify any contradictions."

This is more natural for prose wikis. The LLM handles normalization implicitly during extraction rather than as a separate step.

**Challenger attacks again**: "LLM topic normalization will still produce variants — 'OAuth2' vs 'OAuth 2.0' vs 'authentication'. You'll miss contradictions between files that use different terminology for the same concept."

**Researcher validates**: The datarootsio/knowledgebase_guardian project demonstrates that semantic similarity between extracted topics handles this. **Resolution**: after Phase A, do a lightweight dedup pass — compute embeddings for each extracted topic string, merge topics with cosine similarity > 0.85 into the same group. This uses the already-loaded embedder (no new dep) and handles "OAuth2" / "OAuth 2.0" / "authentication" merging naturally. Cost: ~30 embedding calls for topic strings (sub-millisecond each with the bundled MiniLM model).

**Decision**: Topic-clustered claim extraction with embedding-based topic dedup.

| Aspect | Old (pairwise judge) | New (topic-clustered) |
|---|---|---|
| LLM calls | 50 (1 per pair) | ~20-50 (1 per file + 1 per topic group) |
| Coverage | 50 random pairs from 6000 chunks | All files, all topics |
| Cross-file detection | Accidental (if similar chunks from different files) | Systematic (groups by topic across files) |
| Normalization | None (cosine similarity only) | LLM + embedding dedup |
| Output quality | Binary yes/no per pair | Grouped by topic, contextual explanation |

#### D42 — Gap detection: Hybrid syntactic + LLM filter

**Architect proposes**: Keep the cheap syntactic extraction (extractConcepts) but add an LLM filtering pass. After extracting candidate topics, batch them into a single LLM call: "Here is a list of terms extracted from a technical wiki. Which of these represent real documentation topics that would benefit from a dedicated wiki page? Filter out common words, code syntax, and generic terms."

**Challenger attacks**: "One LLM call to filter 1218 candidates? That's a massive prompt. You'll blow the context window or get unreliable results."

**Architect responds**: Batch in groups of 100 candidates per call. At 1218 candidates, that's ~12 LLM calls. But more importantly, the syntactic filter (`isRealGap()`) is already reducing to 391 "significant" gaps. The LLM filter runs on the post-syntactic set. With a tighter syntactic pre-filter (raise `MIN_TOPIC_LENGTH` to 5, add single-word rejection for terms without spaces, add more stopwords), we can reduce to ~100-200 candidates. One or two LLM calls.

**Challenger attacks again**: "The gap detector runs on every ingest. You're proposing to call the LLM on every file save. That violates the rate-limit rule."

**Researcher validates**: Critical point. The LLM filter should NOT run on every ingest. It should run only during `audit-wiki`. The ingest-time `detectGaps()` continues as-is (cheap syntactic), populating `pinakes_gaps` with noisy candidates. The `audit-wiki` command then runs the LLM filter as a batch cleanup over the accumulated gaps.

**Decision**: Two-tier gap detection. Tier 1 (ingest-time): syntactic extraction with improved stopword list, unchanged. Tier 2 (audit-time): LLM batch filter over accumulated gaps, reducing noise to actionable items. Additionally, leverage graph topology — topics with high wikilink in-degree but no dedicated page are strong gap signals that don't need LLM validation.

#### D43 — Stub generation: Synthesis from context, report-first

**Architect proposes**: Replace empty placeholder stubs with synthesis-from-context. For each confirmed gap, gather all chunks that mention the gap topic (already have mention_count in `pinakes_gaps`), send them to the LLM with: "Synthesize a wiki page about [topic] based solely on what these existing chunks say about it. Include only facts already present in the knowledge base. Mark any uncertain claims."

**Challenger attacks**: "This creates content that looks authoritative but might subtly misrepresent the source chunks. A synthesis error is worse than a placeholder because it gets trusted."

**Architect responds**: Valid concern. **Revised proposal**: Default mode is **report-only** — produce an actionable audit report listing confirmed gaps with a summary of what the wiki already says about each topic (gathered mentions). Stub generation becomes opt-in via `--generate-stubs` flag, and stubs are written to `_audit-drafts/` subdirectory (gitignored by default), not to the main wiki root. The audit report includes a review checklist.

**Challenger agrees**: "Report-first is correct. The human or a reviewing LLM decides what to promote. No auto-pollution of the wiki."

**Decision**: Default is report-only with context summaries. Opt-in `--generate-stubs` writes to `_audit-drafts/`, not wiki root.

#### D44 — Progress feedback: Phased progress with callbacks

**Architect proposes**: Add a progress callback mechanism to all long-running audit operations. The `audit-wiki` command prints phase headers and per-item progress:

```
Phase 1/3: Extracting topics and claims from 18 wiki files...
  [1/18] architecture.md — 5 topics, 12 claims
  [2/18] auth-decisions.md — 3 topics, 7 claims
  ...
Phase 2/3: Comparing claims across 24 topic groups...
  [1/24] authentication — 4 claims from 3 files — no contradictions
  [2/24] database-schema — 6 claims from 2 files — 1 CONTRADICTION found
  ...
Phase 3/3: Filtering gaps and generating report...
  87 candidate gaps → 12 confirmed → report written
```

**Challenger attacks**: "This is cosmetic. The real issue is that each LLM call can take 2-60 seconds. Between progress lines, the user still waits."

**Architect responds**: Each LLM call is bounded (D36 providers have 30s/60s timeouts). The progress line prints BEFORE each call, so the user sees which file/topic is being processed. If a call takes 30s, the user sees `[3/18] database.md...` and knows progress is happening. Additionally, emit elapsed time per item so the user can estimate remaining time.

**Decision**: Three-phase progress output with per-item indicators, elapsed time, and running totals. No new deps needed — `process.stderr.write()` for progress that doesn't interfere with structured output.

#### D45 — Claims table schema

**New table** `pinakes_claims` for persisting extracted claims across audit runs:

```sql
CREATE TABLE pinakes_claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope TEXT NOT NULL,
  source_uri TEXT NOT NULL,
  chunk_id TEXT,
  topic TEXT NOT NULL,
  claim TEXT NOT NULL,
  extracted_at INTEGER NOT NULL,
  FOREIGN KEY (chunk_id) REFERENCES pinakes_chunks(id) ON DELETE SET NULL
);
CREATE INDEX idx_claims_topic ON pinakes_claims(scope, topic);
```

**Rationale**: Persisting claims means subsequent audit runs can skip re-extraction for unchanged files (compare `source_sha` from `pinakes_nodes`). Only new/changed files need re-extraction. This amortizes the LLM cost over time.

#### D46 — Audit report format

The audit report (`_audit-report.md`) is restructured into three sections with actionable items:

1. **Contradictions** — grouped by topic, with source file references, the conflicting claims quoted, and a suggested resolution action.
2. **Documentation Gaps** — LLM-filtered list of real topics that need dedicated pages, with a summary of what the wiki already says about each topic (context from mentions).
3. **Health Metrics** — file count, chunk count, topic coverage, orphan pages (no incoming links), stale pages (not updated recently).

### Loop 4: Phased Implementation Plan

See PRD.md Phase 9 for the detailed breakdown. Summary:

| Sub-phase | Goal | LLM calls | Effort |
|---|---|---|---|
| 9.1 | Progress framework + improved syntactic gap filter | 0 | 1/2 day |
| 9.2 | Topic-claim extraction (Phase A of contradiction pipeline) | 1 per wiki file | 1 day |
| 9.3 | Cross-file contradiction comparison (Phase B) + claims table | 1 per topic group | 1/2 day |
| 9.4 | LLM gap filter + graph topology gaps + report generation | 1-2 batch calls | 1/2 day |
| 9.5 | Opt-in synthesis stubs + testing | 1 per stub | 1/2 day |

**Total**: ~3 days, ~40-80 LLM calls per full audit run on a 20-file wiki.

### Loop 6: Gap Analysis

| # | Gap | Severity | Mitigation |
|---|---|---|---|
| G12 | Claims table adds a 9th table to the schema — needs a Drizzle migration | Low | Standard `drizzle-kit generate`; table is optional (only populated by audit-wiki) |
| G13 | LLM extraction quality varies by provider — Ollama local models may produce worse claims than API models | Medium | Accept degraded quality with local models; document that API providers (Anthropic, OpenAI) produce better audit results; non-fatal — audit still runs, just with more noise |
| G14 | Topic embedding dedup threshold (0.85) may merge distinct topics or fail to merge synonyms | Low | Make threshold configurable via `--topic-similarity` flag; default 0.85 based on MiniLM empirical clustering quality |
| G15 | Unchanged file skip relies on `source_sha` from `pinakes_nodes`; if a file is changed but not yet re-ingested, claims will be stale | Low | Run a consistency check at audit start: compare disk `source_sha` to DB `source_sha`, warn on mismatches, optionally trigger re-ingest for stale files |
| G16 | `_audit-drafts/` directory needs to be gitignored | Low | Append to `.pinakes/.gitignore` on first stub generation |
| G17 | Batching 100 gap candidates per LLM call may exceed context window for smaller models (e.g., Ollama with 4K context) | Medium | Detect model context window from provider; fall back to smaller batches (20 per call) for local models |

### Decision log additions

| D# | Decision | Source |
|---|---|---|
| D41 | **Topic-clustered claim extraction** for contradiction detection: Phase A extracts `{topic, claims[]}` per file, Phase B compares claims grouped by topic across files. Embedding-based topic dedup (cosine > 0.85) handles terminology variants. Replaces pairwise LLM judge. | Loop 8 audit-wiki v2 2026-04-11 |
| D42 | **Two-tier gap detection**: Tier 1 (ingest-time) remains syntactic with improved stopwords. Tier 2 (audit-time) adds LLM batch filter over accumulated gaps + graph topology signals (high in-degree, no dedicated page). | Loop 8 audit-wiki v2 2026-04-11 |
| D43 | **Report-first, stubs opt-in**: Default `audit-wiki` produces an actionable report. `--generate-stubs` writes synthesis-from-context drafts to `_audit-drafts/` (gitignored), not wiki root. | Loop 8 audit-wiki v2 2026-04-11 |
| D44 | **Three-phase progress output**: per-item indicators with elapsed time on stderr. No new deps. | Loop 8 audit-wiki v2 2026-04-11 |
| D45 | **`pinakes_claims` table** for persisting extracted claims. Enables incremental audit (skip unchanged files). 9th table in the schema. | Loop 8 audit-wiki v2 2026-04-11 |
| D46 | **Restructured audit report**: contradictions grouped by topic, LLM-filtered gaps with context summaries, health metrics section. | Loop 8 audit-wiki v2 2026-04-11 |

---

## Loop 10: Agent-based wiki audit — Feature Exploration (2026-04-11)

> **Context**: Phase 9 shipped a deterministic pipeline (claims extraction, topic grouping, LLM comparison, gap filtering, report). It works but is rigid — it can only find contradictions between pre-extracted claims, not subtle cross-file inconsistencies like "CONTRIBUTING.md says npm but CLAUDE.md says pnpm". The question: should the audit be reimagined as an LLM agent with tool access that can browse the wiki organically?
>
> **Team**: Architect (proposes), Challenger (attacks), Researcher (validates). All Opus 4.6.
>
> **Mode**: FEATURE MODE — Loop 0 (research) -> Loop 2 (architecture) -> Loop 4 (plan) -> Loop 6 (gap check).

### Loop 0: Research Brief

#### Option inventory

| # | Option | Description |
|---|---|---|
| O1 | **Claude Code skill** | A `.claude/skills/audit-wiki/SKILL.md` file that ships with the repo. The user types `/audit-wiki` and Claude Code loads the skill's system prompt, then the agent uses Claude Code's full tool access (Read, Grep, Glob, Bash, Edit) plus the Pinakes MCP tools (`knowledge_search`, `knowledge_query`). No new code — just a markdown prompt file. |
| O2 | **Standalone tool-use agent** | A new `src/cli/agent-audit.ts` module implementing its own tool-use loop. Defines tools (read_wiki_file, search_wiki, list_files, write_report) and runs the agent loop internally via the LLM provider factory (D36). Works with any LLM provider. |
| O3 | **MCP sampling** | The MCP server uses `sampling/createMessage` to ask the CLIENT's LLM to perform the audit. The server defines tools, the client provides the model. Per MCP 2025-11-25 spec (tool calling in sampling). |
| O4 | **Hybrid: Pipeline + Agent review** | Phase 9 pipeline does cheap/incremental work (claims extraction, gap counting, health metrics). Agent gets a structured briefing from pipeline output and does the deep analysis (reading actual files, finding subtle issues the pipeline missed). |

#### Research findings

**Claude Code skills system** (validated via [official docs](https://code.claude.com/docs/en/skills) and [Anthropic's skills repo](https://github.com/anthropics/skills)):

- Skills are markdown files in `.claude/skills/skill-name/SKILL.md` with YAML frontmatter.
- Frontmatter fields: `name`, `description`, `allowed-tools` (e.g., `Read,Grep,Glob,Bash`), `context: fork` (run in isolated subagent), `agent` (type of subagent), `disable-model-invocation` (manual-only).
- When invoked via `/skill-name`, the skill's markdown content is loaded as the system prompt. Claude Code then uses its full tool surface to execute.
- Token overhead: ~61 tokens for skill metadata in context. The skill instructions themselves are loaded on-demand, not permanently resident.
- Skills can access MCP tools that are connected to the session — so a Pinakes skill would have access to `knowledge_search` and `knowledge_query` automatically.
- `context: fork` runs the skill in an isolated subagent with its own context window — no pollution of the main conversation.
- **Key advantage**: zero implementation code. The skill is a prompt file. Claude Code brings the full agent loop, tool infrastructure, and model.
- **Key limitation**: only works in Claude Code. Not portable to Goose, Codex, Cursor, OpenCode. Violates the client-agnostic constraint from CLAUDE.md.

**MCP sampling** (validated via [MCP spec 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/client/sampling) and [client support investigation](https://github.com/anthropics/claude-code/issues/1785)):

- The 2025-11-25 spec added tool calling in sampling requests (`CreateMessageRequest.params.tools`, `toolChoice`).
- Server-side agent loops: server sends `sampling/createMessage` with tools, client's LLM responds with tool calls, server executes tools, sends new sampling request with results. Loops until final text response.
- **Critical blocker**: as of April 2026, **no major MCP client implements sampling**. Claude Code does not support it. Claude Desktop does not. Cursor does not. Goose does not. Multiple GitHub issues (e.g., [claude-code#1785](https://github.com/anthropics/claude-code/issues/1785), [Roo-Code#5372](https://github.com/RooCodeInc/Roo-Code/issues/5372)) request it, all unresolved.
- The MCP TS SDK has the `createMessage` method on the server class, but it returns an error when no client supports the capability.
- **Verdict**: MCP sampling is a dead end for now. The spec is there, the implementations are not.

**Standalone tool-use agent** (validated via [RepoAudit](https://arxiv.org/html/2501.18160v1), [EMAD multi-agent debate](https://arxiv.org/html/2408.08902v1), and the existing LLM provider factory):

- Building a custom tool-use loop requires: (a) tool definition schema, (b) tool execution dispatch, (c) conversation history management, (d) stop condition detection, (e) error/retry handling, (f) token budget management.
- The LLM provider factory (D36) currently exposes only `complete({ system, prompt, maxTokens }): Promise<string>`. It has no tool-use API. Adding tool-use requires either: extending the provider interface to support `tools` + `tool_choice` parameters and structured tool-call responses, or building a text-based tool-use protocol (parse tool calls from plain text output).
- Text-based tool-use is fragile. Structured tool-use (function calling) is supported by Anthropic API, OpenAI API, and Ollama, but not by `claude -p` subprocess or `codex exec` subprocess.
- Estimated implementation: ~400-600 LOC for the agent loop + ~200 LOC for tool definitions + ~200 LOC for provider extensions = ~800-1000 LOC of new code.
- **Token cost**: an agent browsing 20 wiki files at ~2000 tokens each = ~40K tokens input per file read. If the agent reads 10 files deeply + does 5 search queries, estimated ~60-80K input tokens per audit. At Opus pricing ($5/M input, $25/M output), this is ~$0.30-0.50 per run. At Haiku pricing, ~$0.03-0.05. At Ollama, $0.
- **Key advantage**: portable across all providers. Works headless (CI, cron, automated).
- **Key disadvantage**: significant implementation effort. The agent loop is its own subsystem with edge cases (stuck loops, hallucinated tool calls, exceeding token budgets).

**Hybrid: Pipeline + Agent review**:

- Pipeline handles the cheap, incremental, deterministic work: claims extraction (already built), gap counting, health metrics, topology analysis.
- Agent gets a structured briefing: "Here are the files in the wiki. Here are the contradictions the pipeline found. Here are the gaps. Now read the actual files and look for issues the pipeline missed — tool mismatches, version inconsistencies, stale instructions, missing cross-references."
- The agent operates on pipeline output, not from scratch. This bounds the agent's scope and reduces token cost.
- **Key advantage**: leverages existing Phase 9 work. Agent adds value without replacing what's built.
- **Key disadvantage**: still requires an agent loop implementation (same effort as O2). But the agent's task is more focused.

#### Token cost comparison

| Option | Estimated tokens per audit (20-file wiki) | Dollar cost (Haiku) | Dollar cost (Opus) | Notes |
|---|---|---|---|---|
| O1 (skill) | 100-200K (Claude Code session) | Included in Max sub | Included in Max sub | User's subscription absorbs cost |
| O2 (standalone agent) | 60-80K | $0.03-0.05 | $0.30-0.50 | Per audit run |
| O3 (MCP sampling) | 60-80K | N/A | N/A | No clients implement it |
| O4 (hybrid) | 30-50K (agent portion) + pipeline LLM | $0.02-0.03 + pipeline | $0.15-0.25 + pipeline | Agent scope is bounded |
| Phase 9 pipeline (current) | ~20-40K | $0.01-0.02 | $0.10-0.20 | Already built and working |

### Loop 2: Architecture Decisions (with debate)

#### D47 — Agent audit approach: Claude Code skill (O1) as primary, with pipeline as pre-flight

**Architect proposes**: Ship a Claude Code skill at `.claude/skills/audit-wiki/SKILL.md` that:
1. Runs the existing Phase 9 pipeline first via Bash (`pnpm run pinakes -- audit-wiki`) to get the structured report.
2. Reads the report and the wiki files, then performs deep analysis using Claude Code's full tool access.
3. Produces an enhanced audit report with findings the pipeline couldn't catch.

This is O4 (hybrid) implemented via O1 (skill). Zero new code for the agent loop — Claude Code IS the agent.

**Challenger attacks**: "This violates the client-agnostic constraint from CLAUDE.md. It only works in Claude Code. A user on Goose or Cursor gets nothing."

**Architect responds**: The constraint says 'Do not add client-specific coupling (Electron IPC, Goose-specific channels, etc.).' A skill file is passive content — it doesn't couple the server to Claude Code. The Pinakes MCP server remains client-agnostic. The skill is an *addon* that ships with the repo for users who happen to use Claude Code. Users on other clients still have the Phase 9 pipeline via `pnpm run pinakes -- audit-wiki`. The skill is additive, not exclusive.

Furthermore, the skill approach has overwhelming practical advantages:
- **Zero implementation code.** It's a markdown file with a system prompt.
- **Claude Code's agent loop is battle-tested.** We don't build, debug, or maintain our own tool-use loop.
- **Full tool access.** The agent can Read files, Grep for patterns, Glob for file discovery, use `knowledge_search` and `knowledge_query` MCP tools. It can find "CONTRIBUTING.md says npm but CLAUDE.md says pnpm" because it can literally read both files.
- **`context: fork` isolation.** The audit runs in a subagent that doesn't pollute the user's main conversation.
- **Token cost is absorbed by the user's Claude subscription.** No API key management.

**Challenger attacks again**: "What about O2 (standalone agent)? It would work with any provider."

**Architect responds**: Building a standalone tool-use agent requires ~800-1000 LOC of new code:
- Extending the LlmProvider interface with tool-use support
- Building a conversation history manager
- Building a tool dispatch loop with stop-condition detection
- Handling hallucinated tool calls, stuck loops, token budget overflows
- Testing all of this against 4+ LLM providers

This is a meaningful subsystem. And the result would be inferior to Claude Code's agent, which has years of engineering behind its tool-use loop, retry logic, and context management. We'd be building a worse version of what Claude Code already does.

The right move is: skill for Claude Code users (the majority of our users, given the project started as a Claude Code MCP server), Phase 9 pipeline for everyone else.

**Challenger accepts with a condition**: "Ship O2 (standalone agent) as a future option, not now. Document the extension point. If MCP sampling lands, it becomes O3 automatically. For now, the skill + pipeline hybrid is the right call."

**Decision**: **D47 — Claude Code skill as primary audit agent, Phase 9 pipeline as universal fallback.**

| Aspect | Skill (O1) | Standalone agent (O2) | MCP sampling (O3) | Hybrid (O4) |
|---|---|---|---|---|
| Implementation effort | ~0 (markdown file) | ~800-1000 LOC | Blocked (no clients) | ~800-1000 LOC |
| Client support | Claude Code only | Any provider | None currently | Any provider |
| Agent quality | Excellent (CC's agent) | DIY (fragile) | N/A | DIY (fragile) |
| Tool access | Full (Read, Grep, Glob, MCP) | Limited (custom tools) | MCP tools only | Limited (custom tools) |
| Maintenance burden | Near zero | Ongoing | N/A | Ongoing |
| Token cost model | User's subscription | API/Ollama | Client's model | API/Ollama |
| Can find "npm vs pnpm" | Yes (reads actual files) | Yes (if tools are good) | Yes (if tools are good) | Yes |
| Portability | Claude Code only | Universal | Future | Universal |

**Lock**: Ship the skill. Document the standalone agent as a future extension point for when MCP sampling adoption grows or when users on non-Claude-Code clients need agent-level auditing.

#### D48 — Skill design: pre-flight pipeline + deep agent review

**Decision**: The skill follows a two-phase workflow:

1. **Pre-flight** (deterministic, cheap): Run `pnpm run pinakes -- audit-wiki` via Bash to produce `_audit-report.md`. This leverages all Phase 9 work — claims extraction, contradiction detection, gap filtering, health metrics.

2. **Deep review** (agentic, thorough): Claude reads the audit report, then browses the wiki files looking for issues the pipeline can't catch:
   - Cross-file terminology inconsistencies (npm vs pnpm, different version numbers)
   - Instructions that reference non-existent files or paths
   - Stale information (dates, versions) that may be outdated
   - Contradictions between code conventions (CLAUDE.md) and actual documentation
   - Missing cross-references between related topics
   - Unclear or ambiguous instructions

3. **Output**: Claude produces an enhanced report in the conversation, summarizing both the pipeline findings and its own deep-review findings. Optionally writes the enhanced report to `_audit-report-deep.md`.

#### D49 — Standalone agent as future extension point (deferred)

**Decision**: Document the extension point for a standalone tool-use agent (`src/cli/agent-audit.ts`) but do not implement it now. The prerequisites for a worthwhile standalone agent are:

1. LlmProvider interface extended with tool-use support (tools param, structured tool-call responses)
2. At least 2 providers support structured tool-use (Anthropic API and OpenAI API do; Ollama does; `claude -p` does not)
3. A reusable agent loop abstraction that handles conversation history, stop conditions, and error recovery

When MCP sampling achieves broad client adoption, it becomes the preferred server-side agent mechanism (O3), making O2 unnecessary. Monitor MCP sampling adoption quarterly.

### Loop 4: Implementation Plan

#### What to build (Phase 10)

| Item | Type | Effort |
|---|---|---|
| `.claude/skills/audit-wiki/SKILL.md` | Markdown skill file | 1-2 hours |
| Presearch + PRD updates | Documentation | This document |
| Optional: `_audit-report-deep.md` write support | Enhancement to skill prompt | Included in skill |

**Total effort**: Less than half a day. This is primarily a prompt-engineering exercise, not a coding exercise.

#### Skill file structure

```
.claude/
  skills/
    audit-wiki/
      SKILL.md        # Main skill definition with frontmatter + prompt
```

#### Frontmatter design

```yaml
---
name: audit-wiki
description: Run a deep audit of the project wiki — finds contradictions, gaps, stale info, and terminology inconsistencies
context: fork
allowed-tools: Read,Grep,Glob,Bash,mcp__kg-mcp__kg_search,mcp__kg-mcp__kg_execute
---
```

Key decisions:
- `context: fork` — runs in an isolated subagent. The audit doesn't pollute the user's main conversation context.
- `allowed-tools` — grants file access (Read, Grep, Glob), Bash (for running the pipeline), and the two Pinakes MCP tools. Does NOT grant Write or Edit — the audit is read-only by default.
- `disable-model-invocation` is NOT set — Claude can suggest running the audit when it detects wiki quality issues.

#### Skill prompt design principles

1. **Pipeline-first**: Always run the Phase 9 pipeline before doing agent-level analysis. This grounds the agent in structured findings.
2. **File-reading is the differentiator**: The skill's unique value is reading actual file content and cross-referencing. The pipeline can't do this (it works on chunks and extracted claims).
3. **Structured output**: The agent should produce findings in a consistent format: file, issue type, description, severity, suggested fix.
4. **Bounded scope**: The agent should focus on the wiki directory (`.pinakes/wiki/`), not the entire codebase. Limit to reading wiki files + CLAUDE.md + key config files.
5. **Idempotent**: Running the skill twice on the same wiki should produce similar findings.

### Loop 6: Gap Analysis

| # | Gap | Severity | Mitigation |
|---|---|---|---|
| G18 | Skill only works in Claude Code — users on Goose, Codex, Cursor, OpenCode get no agent audit | Medium | Phase 9 pipeline is the universal fallback. Document this explicitly. Monitor MCP sampling adoption for future O3 implementation. |
| G19 | `context: fork` subagent may not have access to MCP tools in all Claude Code versions | Low | Test against current Claude Code. If MCP tools are unavailable in fork, remove `context: fork` and accept conversation pollution. |
| G20 | MCP tool names in `allowed-tools` may not match — depends on how the user configured the Pinakes server name | Medium | Use env-configurable tool names matching `PINAKES_SERVER_NAME`. Document the default names in the skill instructions. If names don't match, the skill degrades to file-reading-only audit (still valuable). |
| G21 | Token cost of deep review could be high for large wikis (50+ files) | Low | Skill prompt instructs the agent to prioritize: read the pipeline report first, then selectively read files that are flagged or suspicious. Don't read every file. |
| G22 | Skill prompt quality determines audit quality — prompt engineering is empirical | Medium | Ship a v1 prompt, iterate based on real-world results. The skill file is easy to update — it's just markdown. |
| G23 | `allowed-tools` field may not be supported when using Skills through the SDK (per Claude Code docs) | Low | This is a CLI-specific feature. Our primary target is CLI users. SDK users can invoke the audit pipeline directly. |

### Decision log additions

| D# | Decision | Source |
|---|---|---|
| D47 | **Claude Code skill as primary audit agent**: Ship `.claude/skills/audit-wiki/SKILL.md`. Zero implementation code — Claude Code's agent loop provides tool access (Read, Grep, Glob, Bash, MCP tools). Phase 9 pipeline is the universal fallback for non-Claude-Code clients. | Loop 10 agent audit exploration 2026-04-11 |
| D48 | **Skill design: pre-flight + deep review**: Skill runs Phase 9 pipeline via Bash first, then reads actual files to find issues the pipeline misses (terminology inconsistencies, stale info, broken references). Output is a structured findings report. | Loop 10 agent audit exploration 2026-04-11 |
| D49 | **Standalone tool-use agent deferred**: Document extension point at `src/cli/agent-audit.ts` but do not implement. Requires LlmProvider tool-use extension. Monitor MCP sampling adoption as the preferred future path. | Loop 10 agent audit exploration 2026-04-11 |

---

## Loop 12: Knowledge Lifecycle Features — Confidence Decay, Supersession, Crystallization (2026-04-11)

> **Context**: Pinakes v0.2.0 shipped with 269 tests, 15/15 privacy suite, Phases 0-8 complete, Phase 9 (audit pipeline) and Phase 10 (agent skill) designed. The knowledge wiki is functional but treats all knowledge as equally valid and permanent. The LLM Wiki v2 pattern (Rohit Garg's gist, extending Karpathy's original) proposes a richer memory lifecycle: confidence scoring with decay, supersession tracking, and session crystallization. This loop researches how to add these capabilities.
>
> **Team**: Architect (proposes), Challenger (attacks), Researcher (validates). All Opus 4.6.
>
> **Mode**: FEATURE MODE — Loop 0 (research) -> Loop 2 (architecture) -> Loop 4 (plan) -> Loop 6 (gap check).
>
> **Inspiration**: [LLM Wiki v2 gist](https://gist.github.com/rohitg00/2067ab416f7bbe447c1977edaaa681e2)

### Loop 0: Research Brief

#### Feature 1: Confidence Scoring with Decay

**Current state**: `pinakes_nodes.confidence` is a TEXT column with enum values `'extracted' | 'inferred' | 'ambiguous'`. It is set once at ingest time by `detectConfidence()` in `src/ingest/parse/markdown.ts` based on syntactic heuristics (e.g., files in certain paths are `'inferred'`). It is passed through the retrieval pipeline (FTS, vec, hybrid, RRF fusion) as a metadata field but never used as a ranking signal. The LLM can filter by confidence via code-mode (`results.filter(r => r.confidence === 'extracted')`) but the system itself treats all nodes equally.

`pinakes_nodes.last_accessed_at` exists and is bumped by `touchNodesByChunkIds()` in `src/db/repository.ts` on every search hit. It is intended for personal KG LRU eviction (CLAUDE.md §Database Rules #12) but eviction is not yet implemented — the comment says "eviction is a future concern, not a hot path."

**Research findings — decay functions**:

| Model | Formula | Parameters | Pros | Cons | Source |
|---|---|---|---|---|---|
| **Ebbinghaus exponential** | R = e^(-t/S) | S = stability (time unit), t = elapsed time | Simple, well-understood | Oversimplified for our use case — we're not modeling human memory recall | [Wikipedia: Forgetting curve](https://en.wikipedia.org/wiki/Forgetting_curve) |
| **Power-law decay** | R = (1 + factor * t/S)^(-decay) | S = stability, factor and decay are trainable | More flexible than exponential, matches empirical data better | More complex, needs parameter tuning | [FSRS algorithm](https://github.com/open-spaced-repetition/awesome-fsrs/wiki/The-Algorithm) |
| **SM-2 ease factor** | EF = EF + (0.1 - (5-q) * (0.08 + (5-q) * 0.02)) | EF = ease factor, q = quality 0-5 | Battle-tested in Anki/SuperMemo, handles reinforcement | Designed for flashcard Q&A, not knowledge provenance | [SuperMemo SM-2](https://www.supermemo.com/en/archives1990-2015/english/ol/sm2) |
| **FSRS-6 (2024)** | R(t,S) = (1 + factor * t/S)^(-w20), 21 trainable params | S = stability, D = difficulty, G = grade | State of the art for spaced repetition | Way over-engineered for our case — we're not scheduling reviews | [FSRS wiki](https://github.com/open-spaced-repetition/awesome-fsrs/wiki/The-Algorithm) |
| **Simple half-life decay** | score = base * 0.5^(t/half_life) | base = initial score, half_life = domain-specific constant | Dead simple, one parameter | No reinforcement mechanism built-in | Common in caching systems |

**Research findings — confidence in other KG systems**:

| System | How confidence works | Notes |
|---|---|---|
| **obra/knowledge-graph** | No confidence scoring | Pure retrieval, no lifecycle |
| **basic-memory** | No confidence scoring | Karpathy pattern, no decay |
| **datarootsio/knowledgebase_guardian** | Uses LLM-assigned confidence per contradiction finding | Per-finding, not per-node |
| **Obsidian (Ar9av plugin)** | Provenance tags only | Static labels, no decay |
| **LLM Wiki v2 (Rohit gist)** | "Every fact carries confidence score tracking supporting sources, recency, and contradictions. Starts at 0.85 for single-source claims. Decays via Ebbinghaus curve. Reinforcement resets curve." | Conceptual — no implementation reference |

**Research findings — using confidence in ranking**:

In hybrid search (RRF fusion), confidence could be a third signal alongside FTS rank and vec distance. But this risks burying recently-ingested content that hasn't been corroborated yet. The LLM Wiki v2 gist suggests confidence should affect eviction and audit surfacing, not primary search ranking. The LLM can already filter by confidence via code-mode — making it a server-side ranking signal adds complexity without clear benefit given that the LLM is the precision layer (Phase 7.5 architecture decision).

#### Feature 2: Supersession Tracking

**Current state**: When a wiki file is rewritten, the ingester (`src/ingest/ingester.ts`) deletes all old nodes for that file and inserts new ones. Old content is gone. `pinakes_claims` stores extracted claims but has no history — re-extraction replaces old claims. `pinakes_edges` supports an `edge_kind = 'supersedes'` value but no code populates it.

The contradiction detector (Phase 9) compares claims across files but cannot say "this claim used to say X, now it says Y." The audit report shows current contradictions but not how claims evolved.

**Research findings — supersession approaches**:

| Approach | Mechanism | Storage cost | Query cost | Complexity |
|---|---|---|---|---|
| **Soft-delete with versioning** | Add `superseded_by` FK + `superseded_at` timestamp to claims. Old claims kept but marked stale. | ~2x claims table size over time | Simple WHERE filter | Low |
| **Separate history table** | `pinakes_claims_history` mirrors claims schema + `valid_from`, `valid_until`. On re-extraction, move old to history, insert new. | Unbounded growth | JOIN for temporal queries | Medium |
| **Event-sourced claims** | Every claim change is an event: `{action: 'create'|'supersede'|'retract', claim_id, ts}`. Current state computed from event replay. | Events grow monotonically | Expensive replay | High — overkill for our scale |
| **Claim-level edges** | `pinakes_edges` with `edge_kind = 'supersedes'` between old and new claim node IDs. Reuse existing edge infrastructure. | Minimal (one edge per supersession) | Graph traversal | Medium — but claims aren't nodes currently |
| **Claim versioning in claims table** | Add `version INTEGER`, `prev_claim_id INTEGER` to `pinakes_claims`. On re-extraction, increment version, link to predecessor. | ~1.5x over time (with cleanup) | Self-JOIN | Low-medium |

#### Feature 3: Crystallization (Session Distillation)

**Current state**: No automatic knowledge capture exists. The LLM can manually write to the wiki via `pinakes.project.write(path, content)` inside `execute`, but there is no trigger mechanism, no session boundary detection, and no distillation logic.

The Phase 10 audit skill (`/audit-wiki`) shows the pattern of using Claude Code as the agent runtime. Crystallization could follow the same pattern: a Claude Code skill that runs at session end.

**Research findings — session distillation approaches**:

| Approach | Trigger | Input | Output | Complexity |
|---|---|---|---|---|
| **Claude Code skill (post-session)** | User types `/crystallize` or it runs via a hook | Git diff + conversation context (via Claude Code's agent state) | Wiki page(s) summarizing session | Low — same as D47, just a markdown prompt file |
| **Git hook (post-commit)** | `post-commit` git hook | Git diff of committed files | Wiki page(s) updating relevant knowledge | Medium — needs to call LLM, parse diff |
| **Chokidar-triggered auto-distill** | File changes detected by existing chokidar watcher | Changed files + existing wiki context | Auto-updated wiki sections | High — runs on every save, noisy |
| **CLI command** | `pnpm run pinakes -- crystallize` | Git log since last crystallize + file diffs | Session summary wiki page | Low-medium |
| **Idle-triggered** | No file changes for N minutes (session ended) | Git diff since last crystallize | Wiki page | Medium — fragile heuristic for "session end" |

**Research findings — noise prevention**:

The LLM Wiki v2 gist warns that "automated systems compound errors without human validation gates." Key noise risks:
- Crystallizing every tiny change (typo fixes, formatting) creates noise
- LLM-synthesized summaries may hallucinate connections not in the diff
- Repeated crystallization of the same work (user saves file 10 times during a session)

Mitigations: minimum diff size threshold, deduplication against existing wiki content, `_drafts/` staging area (reuse D43 pattern), human review gate.

### Loop 2: Architecture Decisions (with debate)

#### D50 — Confidence scoring: Simplified half-life decay with corroboration boost

**Architect proposes**: Replace the TEXT `confidence` column with a REAL `confidence_score` column (0.0-1.0) and add two supporting columns:

```sql
ALTER TABLE pinakes_nodes ADD COLUMN confidence_score REAL NOT NULL DEFAULT 0.7;
ALTER TABLE pinakes_nodes ADD COLUMN corroboration_count INTEGER NOT NULL DEFAULT 1;
ALTER TABLE pinakes_nodes ADD COLUMN confidence_updated_at INTEGER NOT NULL DEFAULT 0;
```

The decay function is a simple half-life model:

```
effective_confidence = confidence_score * 0.5^(elapsed_days / half_life_days)
```

Where:
- `confidence_score` is the base score, set at ingest and boosted by corroboration
- `half_life_days` depends on the node's `kind`: architecture decisions = 180 days (slow decay), log entries = 30 days (fast decay), sections = 90 days (medium)
- `corroboration_count` tracks how many independent sources support this node's claims (via `pinakes_claims` cross-referencing)
- On each access (`last_accessed_at` bump), the score does NOT reset — access is not reinforcement, corroboration is

Score lifecycle:
1. **Fresh ingest**: score = 0.7 (single-source default)
2. **Corroborated**: score += 0.1 per additional source, capped at 1.0
3. **Contradiction found**: score -= 0.2 per active contradiction (from Phase 9 claims comparison)
4. **Time decay**: computed at query time, never stored (avoids write amplification)
5. **Personal KG eviction**: sort by `effective_confidence` instead of pure `last_accessed_at`; evict lowest-confidence nodes first when over the 5000-chunk cap

**Challenger attacks**: "You're adding three columns to `pinakes_nodes` for a feature that the LLM can already simulate via code-mode. The LLM can compute `days_since_updated` from `updated_at` and filter on that. The corroboration count is just `SELECT count(*) FROM pinakes_claims WHERE topic LIKE '%' || node_title || '%'`. You're baking heuristics into the schema that will need constant tuning."

**Architect responds**: The Challenger is right that the LLM CAN compute this, but it shouldn't HAVE to on every query. The effective confidence is a pre-computed signal that:
1. Makes personal KG eviction smarter (the real motivation — pure LRU evicts recently-ingested-but-unread content, which is wrong)
2. Surfaces in search results so the LLM can make quick decisions without running additional queries
3. Is cheap to compute (one multiplication at query time)

However, the Challenger's point about schema bloat is valid. **Revised proposal**: keep it minimal.

- Add ONE column: `confidence_score REAL DEFAULT 0.7` (replaces the TEXT `confidence` enum — the enum values map to numeric scores: extracted=0.7, inferred=0.5, ambiguous=0.3)
- Time decay is computed at query time in the SQL: `confidence_score * power(0.5, (julianday('now') - julianday(updated_at/1000, 'unixepoch')) / half_life_days)` — but SQLite doesn't have `power()`. Use the identity: `0.5^x = exp(-0.693 * x)`, and SQLite does NOT have `exp()` either without an extension.
- **Key realization**: SQLite lacks `exp()` and `power()`. Computing decay in SQL requires either a user-defined function or computing it in JS after the query.

**Challenger attacks again**: "So you can't even compute this in the database. You'll compute it in JS post-query. At that point, why store anything extra? Just compute `(Date.now() - node.updated_at) / HALF_LIFE_MS` in the sandbox binding and multiply by the confidence enum value. Zero schema change needed."

**Architect responds**: The Challenger makes a strong point. The decay computation is trivial JS. But `corroboration_count` is not — it requires a claims cross-reference that's expensive to compute per-query. And for personal KG eviction (the motivating use case), we need a pre-computed score that the eviction query can ORDER BY without joining through claims.

**Resolution**: 

1. **Add `confidence_score REAL DEFAULT 0.7`** — replaces the TEXT confidence enum. The existing code paths that read `confidence` as a string get a migration that maps `'extracted' -> 0.7, 'inferred' -> 0.5, 'ambiguous' -> 0.3`. New code uses the numeric score.
2. **Decay is computed in JS, not SQL** — the sandbox binding (`pinakes.project.hybrid()`, `pinakes.project.fts()`, etc.) enriches each result with `effective_confidence` computed as `confidence_score * Math.pow(0.5, days_elapsed / half_life_days)`. Half-life is configurable per-node-kind via a lookup table in the binding code.
3. **Corroboration is a background job, not a query-time join** — a periodic `updateCorroboration()` function (called during ingest or audit) counts claims per node and bumps `confidence_score`. Stored, not computed per-query.
4. **Personal KG eviction uses `confidence_score * recency_factor`** — combining the stored confidence with a time-based factor, replacing pure LRU.

**Decision**: D50 — Numeric confidence score (one new REAL column) with JS-computed decay at query time and background corroboration updates.

| Aspect | Current (TEXT enum) | Proposed (REAL score + JS decay) |
|---|---|---|
| Schema change | None | One ALTER TABLE ADD COLUMN |
| Query-time cost | Zero | ~0.1ms JS computation per result |
| Eviction quality | Pure LRU (wrong for unread-but-new content) | Confidence-weighted (correct) |
| LLM signal | String filter only | Numeric comparison + sorting |
| Migration risk | N/A | Low — additive column, backfill is a single UPDATE |

#### D51 — Supersession: Claim versioning with soft-delete

**Architect proposes**: Extend `pinakes_claims` with version tracking:

```sql
ALTER TABLE pinakes_claims ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE pinakes_claims ADD COLUMN superseded_by INTEGER REFERENCES pinakes_claims(id) ON DELETE SET NULL;
ALTER TABLE pinakes_claims ADD COLUMN superseded_at INTEGER;
```

When `extractAllClaims()` re-extracts claims for a file:
1. Instead of `DELETE FROM pinakes_claims WHERE source_uri = ?`, mark old claims as superseded: set `superseded_at = now`, `superseded_by = new_claim_id` (matched by topic similarity)
2. Insert new claims with `version = old_version + 1`
3. Matching old-to-new claims uses topic equality (exact match) + claim embedding similarity for fuzzy matching

This enables:
- "What changed?" queries: `SELECT old.claim, new.claim FROM pinakes_claims old JOIN pinakes_claims new ON old.superseded_by = new.id WHERE old.topic = ?`
- Audit reports showing claim evolution: "Previously said X (from auth.md, 2026-04-01), now says Y (from auth.md, 2026-04-11)"
- Temporal queries: "What did the wiki say about authentication two weeks ago?"

**Challenger attacks**: "Matching old claims to new claims is the hard problem. If a file is rewritten significantly, the topics may shift, claims may be split or merged. Your `superseded_by` FK assumes a 1:1 correspondence that doesn't exist for major rewrites."

**Architect responds**: Fair. The matching is best-effort, not guaranteed. For minor updates (the common case — one fact changes), topic equality + claim similarity works well. For major rewrites, we fall back to: mark all old claims as superseded (without a specific successor), insert all new claims as v1. The `superseded_by` FK is nullable — `NULL` means "this claim was retired, we don't know what replaced it."

**Challenger attacks again**: "How much history do you keep? If a file is rewritten weekly for 6 months, you'll have 26 versions of each claim. The claims table grows without bound."

**Architect responds**: Good catch. Add a retention policy: keep at most `MAX_CLAIM_VERSIONS` (default 5) per topic per source_uri. On insert, if the chain exceeds the limit, hard-delete the oldest superseded claims. This bounds growth at ~5x the active claim count.

**Decision**: D51 — Claim versioning via soft-delete with `superseded_by` FK, bounded at 5 versions per topic per file.

| Aspect | Current (delete + reinsert) | Proposed (soft-delete + version chain) |
|---|---|---|
| Schema change | None | Three ALTER TABLE ADD COLUMN on pinakes_claims |
| History | None | Up to 5 versions per claim per file |
| "What changed?" | Impossible | Simple JOIN query |
| Audit integration | Shows current contradictions only | Shows evolution of contradictions over time |
| Storage growth | Bounded (only current claims) | Bounded (5x current claims max) |
| Migration risk | N/A | Low — additive columns, existing claims get version=1 |

#### D52 — Crystallization: Claude Code skill with CLI fallback

**Architect proposes**: Follow the D47 pattern — ship a Claude Code skill at `.claude/skills/crystallize/SKILL.md` that:
1. Reads `git diff` (or `git log --since` if given a timeframe) to identify what changed
2. Reads the changed files and existing wiki context via MCP tools
3. Synthesizes wiki entries summarizing decisions made, lessons learned, and knowledge gained
4. Writes draft pages to `_crystallize-drafts/` via Bash (not directly to wiki — matches D43 report-first pattern)
5. Optionally promotes drafts to wiki via `pinakes.project.write()` if the user confirms

Additionally, a CLI command `pnpm run pinakes -- crystallize` provides the universal fallback for non-Claude-Code clients, using the LLM provider factory (D36).

**Challenger attacks**: "This is just a fancy git-diff summarizer. How is it different from `git log --oneline`? The value is supposed to be distilling DECISIONS and LEARNINGS, not just listing file changes."

**Architect responds**: The skill prompt is the differentiator. It doesn't just list changes — it asks:
1. "What architectural decisions were made in this session? (e.g., chose library X over Y, decided on pattern Z)"
2. "What was learned that should be remembered for future sessions? (e.g., gotcha with API X, workaround for bug Y)"
3. "What existing wiki pages should be updated based on this session's work?"

The git diff is the INPUT, not the output. The LLM synthesizes from the diff + existing wiki context.

**Challenger attacks again**: "What about noise? A session with 50 files changed (refactoring) will produce a massive diff that overwhelms the LLM's context window."

**Architect responds**: The skill prompt handles this:
1. Filter diff to significant changes only (exclude test files, generated files, lockfiles by default — configurable)
2. Summarize large diffs before detailed analysis (two-pass: first get overview, then drill into interesting changes)
3. Minimum diff size: skip if fewer than 10 lines changed (configurable)
4. Maximum diff size: if diff exceeds 50K tokens, take only the most recently modified files up to the limit

**Challenger accepts**: "The skill approach is correct. Zero implementation code for Claude Code users, CLI fallback for others. The prompt engineering is the hard part but it's iteratable."

**Decision**: D52 — Crystallization as a Claude Code skill + CLI fallback. Drafts go to `_crystallize-drafts/`, not wiki root. Prompt handles noise via diff filtering and two-pass summarization.

| Aspect | Skill approach | CLI approach |
|---|---|---|
| Trigger | User types `/crystallize` | User runs `pnpm run pinakes -- crystallize` |
| Agent runtime | Claude Code (battle-tested) | Internal LlmProvider tool-use (D49-level effort) |
| Tool access | Full (Read, Grep, Glob, Bash, MCP) | LlmProvider.complete() + file I/O |
| Implementation effort | ~0 (markdown prompt file) | ~300-500 LOC for diff parsing + LLM orchestration |
| Quality | Excellent (Claude reads actual files) | Good (but limited to LLM provider quality) |
| Client support | Claude Code only | Universal |

#### D53 — Half-life configuration per node kind

**Decision**: The decay half-life is not a single global constant but varies by content type:

| Node kind | Half-life (days) | Rationale |
|---|---|---|
| `'section'` (default) | 90 | General wiki content, medium decay |
| `'decision'` | 180 | Architecture decisions are long-lived |
| `'log_entry'` | 30 | Session logs decay fast |
| `'gap'` | 60 | Gaps are actionable items, moderate urgency |
| `'entity'` | 120 | Named entities (tools, libs) are semi-stable |

Configurable via `PINAKES_DECAY_HALF_LIFE_DEFAULT` env var (overrides all kinds) or per-kind via `pinakes_meta` key `decay_half_life:<kind>`.

The half-life lookup table lives in `src/gate/confidence.ts` (new module), NOT in the schema. Schema stores the base `confidence_score`; the decay computation happens in JS.

#### D54 — Interaction between features: confidence drives eviction, supersession feeds confidence, crystallization creates high-confidence nodes

**Decision**: The three features form a virtuous cycle:

1. **Supersession -> Confidence**: When a claim is superseded, the old claim's node gets a confidence penalty (the node has stale information). The new claim's node gets a slight boost (it's more current). This is computed during `extractAllClaims()` when version chains are created.

2. **Confidence -> Eviction**: Personal KG eviction (5000-chunk cap) sorts by `effective_confidence` (base score * time decay) instead of pure `last_accessed_at`. Low-confidence, old, uncorroborated nodes are evicted first. High-confidence, recently-corroborated nodes survive.

3. **Crystallization -> High-confidence nodes**: Wiki pages created by crystallization start with `confidence_score = 0.8` (higher than the 0.7 default) because they are synthesized from multiple sources (the session's actual file changes). They also link back to source files via wikilinks, increasing their corroboration count over time.

4. **Confidence -> Search surfacing**: The `effective_confidence` is included in search results as a metadata field. The LLM can use it for triage: "This result has confidence 0.92 (well-corroborated, recent) vs this one at 0.31 (old, single-source, decayed)."

### Loop 4: Phased Implementation Plan

**Recommendation**: These three features should be **one phase (Phase 11)** split into three sub-phases, because they share schema migration work and the confidence scoring is a prerequisite for the other two to deliver their full value.

| Sub-phase | Feature | Effort | LLM calls | Depends on |
|---|---|---|---|---|
| **11.1** | Confidence scoring + decay | 1 day | 0 | Phase 9 (claims table exists) |
| **11.2** | Supersession tracking | 1 day | 0 (runs during existing claim extraction) | Phase 11.1 (confidence_score column exists) |
| **11.3** | Crystallization skill + CLI | 1/2 day (skill) + 1 day (CLI) | 1-5 per crystallize run | Phase 11.1 (confidence_score for new nodes) |

**Total**: ~3.5 days.

**Integration with existing phases**:
- Phase 9 (claims extraction) gains supersession tracking in 11.2 — `extractAllClaims()` is modified to soft-delete instead of hard-delete
- Phase 10 (audit skill) gains confidence-based findings in 11.1 — "these nodes have decayed confidence, consider reviewing"
- Phase 5 (personal KG) gains confidence-weighted eviction in 11.1 — replaces the TODO LRU eviction
- Phase 7.5 (search) gains `effective_confidence` metadata in 11.1 — enriches search results

### Loop 6: Gap Analysis

| # | Gap | Severity | Mitigation |
|---|---|---|---|
| G24 | **`confidence` TEXT -> REAL migration**: Existing code reads `confidence` as a string (`r.confidence === 'extracted'`). Every call site needs updating. Sandbox bindings expose confidence as a string in the type declarations. Code-mode callers that filter on string values will break. | **High** | Keep BOTH columns during transition: add `confidence_score REAL` alongside existing `confidence TEXT`. Deprecate the TEXT column but don't remove it until v1. Update bindings to expose both `confidence` (string, deprecated) and `confidence_score` (number). Backfill: `UPDATE pinakes_nodes SET confidence_score = CASE confidence WHEN 'extracted' THEN 0.7 WHEN 'inferred' THEN 0.5 WHEN 'ambiguous' THEN 0.3 ELSE 0.7 END`. |
| G25 | **SQLite lacks `exp()` and `power()`**: Cannot compute decay in SQL ORDER BY. Must compute in JS post-query, which means the DB can't sort by effective_confidence for eviction. | Medium | For eviction, pre-compute and store `effective_confidence` periodically (e.g., on startup, on audit). For query-time, compute in the JS binding layer after fetching results. This is fine because we always post-process results anyway (RRF fusion, budget gate). |
| G26 | **Claim matching for supersession is fuzzy**: When a file is rewritten, matching old claims to new claims requires topic equality + semantic similarity. False matches create wrong supersession chains. | Medium | Use strict topic equality as the primary match key. Only attempt semantic matching (via embedder) as a secondary signal for claims with the same topic but different wording. If similarity < 0.8, don't link — just mark old as superseded without a successor. Accept that major rewrites will produce "orphaned supersessions" (old claims retired without specific successors). |
| G27 | **Unbounded claim history growth**: Even with the 5-version cap per topic per file, a wiki with 200 topics across 20 files could accumulate 200 * 20 * 5 = 20,000 historical claims. | Low | 20K rows in SQLite is trivial (< 1MB). The real cost is query complexity for temporal views. Add a `pinakes -- claims-cleanup` CLI command that hard-deletes superseded claims older than N days (default 180). |
| G28 | **Crystallization quality depends entirely on prompt engineering**: Bad prompts produce noise (vague summaries, hallucinated decisions). No programmatic quality gate. | Medium | Ship to `_crystallize-drafts/` (never directly to wiki). The user or a reviewing agent must explicitly promote drafts. Include a quality checklist in the draft header. The skill prompt should instruct the LLM to be conservative: "Only record decisions and learnings that are clearly supported by the diff. When uncertain, omit rather than speculate." |
| G29 | **Confidence decay may confuse the LLM**: A node with `effective_confidence: 0.35` (decayed from 0.7 over 6 months) may be perfectly valid content that just hasn't been updated. The LLM might mistakenly deprioritize it. | Low | Include `days_since_update` alongside `effective_confidence` in search results so the LLM can distinguish "low confidence because old" from "low confidence because contradicted." Update tool descriptions to explain the confidence model. |
| G30 | **Crystallization triggers during active coding sessions could be disruptive**: If the skill runs mid-session, it may capture incomplete work. | Low | The skill is manual-trigger only (`/crystallize`). No automatic triggers. The CLI version requires explicit invocation. Document that crystallization is best run at session end, not mid-session. |
| G31 | **Backward compatibility of confidence_score with existing tests**: 269 existing tests may reference `confidence: 'extracted'` string comparisons. | Medium | The transition keeps the TEXT column alive (G24 mitigation). Tests that check `confidence === 'extracted'` continue to pass. New tests use `confidence_score >= 0.7`. Deprecation warnings in Phase 12 or v1. |

### Decision log additions

| D# | Decision | Source |
|---|---|---|
| D50 | **Numeric confidence score**: Add `confidence_score REAL DEFAULT 0.7` to `pinakes_nodes`. Decay computed in JS at query time via `score * Math.pow(0.5, days_elapsed / half_life)`. Corroboration updates stored score during ingest/audit. Replaces pure LRU with confidence-weighted eviction for personal KG. TEXT `confidence` column preserved for backward compat. | Loop 12 knowledge lifecycle 2026-04-11 |
| D51 | **Claim supersession via soft-delete**: Add `version`, `superseded_by`, `superseded_at` to `pinakes_claims`. Re-extraction soft-deletes old claims instead of hard-deleting. Bounded at 5 versions per topic per file. Enables "what changed?" temporal queries and audit report evolution tracking. | Loop 12 knowledge lifecycle 2026-04-11 |
| D52 | **Crystallization as Claude Code skill + CLI**: Skill at `.claude/skills/crystallize/SKILL.md` distills git diffs into wiki draft pages. CLI fallback via `pnpm run pinakes -- crystallize`. Drafts to `_crystallize-drafts/`, never wiki root directly. Prompt handles noise via diff filtering and two-pass summarization. | Loop 12 knowledge lifecycle 2026-04-11 |
| D53 | **Per-kind decay half-lives**: section=90d, decision=180d, log_entry=30d, gap=60d, entity=120d. Configurable via env var or `pinakes_meta`. Lookup table in `src/gate/confidence.ts`. | Loop 12 knowledge lifecycle 2026-04-11 |
| D54 | **Feature interaction cycle**: Supersession feeds confidence (stale claim = confidence penalty). Confidence drives eviction (low effective_confidence evicted first). Crystallization creates high-confidence nodes (0.8 base). Confidence surfaces in search results for LLM triage. | Loop 12 knowledge lifecycle 2026-04-11 |

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
- **Contradiction detection (Loop 8)**: [datarootsio/knowledgebase_guardian](https://github.com/datarootsio/knowledgebase_guardian), [arxiv 2504.00180 — RAG contradiction detection](https://arxiv.org/abs/2504.00180), [Stanford NLP contradiction detection](https://nlp.stanford.edu/pubs/contradiction-acl08.pdf), [Springer formal logic + LLMs](https://link.springer.com/article/10.1007/s10515-024-00452-x), [ACL 2025 factual inconsistency detection](https://aclanthology.org/2025.findings-acl.1305.pdf)
- **Agent audit exploration (Loop 10)**: [Claude Code skills docs](https://code.claude.com/docs/en/skills), [Anthropic skills repo](https://github.com/anthropics/skills), [MCP sampling spec 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/client/sampling), [MCP sampling client support issue](https://github.com/anthropics/claude-code/issues/1785), [MCP 2026 roadmap](https://blog.modelcontextprotocol.io/posts/2026-mcp-roadmap/), [RepoAudit — LLM agent for code auditing](https://arxiv.org/html/2501.18160v1), [Claude Code subagents docs](https://code.claude.com/docs/en/sub-agents), [MCP sampling attack vectors](https://unit42.paloaltonetworks.com/model-context-protocol-attack-vectors/)
- **Knowledge lifecycle (Loop 12)**: [LLM Wiki v2 gist (Rohit Garg)](https://gist.github.com/rohitg00/2067ab416f7bbe447c1977edaaa681e2), [Wikipedia: Forgetting curve](https://en.wikipedia.org/wiki/Forgetting_curve), [Wikipedia: Spaced repetition](https://en.wikipedia.org/wiki/Spaced_repetition), [FSRS algorithm](https://github.com/open-spaced-repetition/awesome-fsrs/wiki/The-Algorithm), [Karpathy LLM-Wiki gist](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)
