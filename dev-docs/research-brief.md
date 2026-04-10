# KG-MCP Research Brief (Loop 0)

> Compiled 2026-04-08 from three parallel Opus-4.6 research agents. All claims sourced; confidence ratings inline. Feeds Loop 1 (constraints) and Loop 2 (architecture).

## Context snapshot

- **Product**: a code-mode MCP server that indexes a two-level Karpathy wiki (project + personal) and exposes it to a coding LLM (Claude via `claude-acp`, Codex, or any Goose-supported provider) via MCP.
- **Parent app**: Pharos, a fork of Block's Goose Desktop at `~/dev/gauntlet/pharos` (repo name `pella-labs/pharos`). Pharos is in Phase 0 (eval suite + scaffold). Parent presearch is locked at `docs/PRESEARCH.md`.
- **Integration**: our MCP plugs into Pharos via Goose's native MCP extension system. No new installer. Pharos already plans SQLite via Drizzle at `<projectDir>/.pharos/pharos.db`.
- **Timeline**: feasibility spike needed **today**. This is an exploration, not a production build.

## Decision-shaping findings

### 1. Claude Code enforces a hard 25,000-token cap on every MCP tool response

Exceeding it returns `Error: MCP tool "X" response (N tokens) exceeds maximum allowed tokens (25000). Please use pagination, filtering, or limit parameters`. Confirmed via three independent reports ([simas_ch](https://x.com/simas_ch/status/1952081786416079210), [community discussion 169224](https://github.com/orgs/community/discussions/169224), [serena issue 516](https://github.com/oraios/serena/issues/516)).

**Implication**: the read API must budget-shape every response. Code-mode is not an optimization — it is the only pattern that gracefully handles this cap, because the LLM filters locally inside the sandbox and returns only what it needs. Cloudflare's claim of ~1K tokens vs. ~1.17M tokens for the 2500-endpoint API ([code-mode-mcp blog](https://blog.cloudflare.com/code-mode-mcp/); independently [benchmarked at 81% token reduction](https://workos.com/blog/cloudflare-code-mode-cuts-token-usage-by-81)) validates the pattern.

**Confidence: High.**

### 2. `@cloudflare/codemode` has a pluggable `Executor` interface — we don't reimplement code-mode

Cloudflare explicitly documents the `Executor` interface as target-agnostic for "Node VM, QuickJS, containers" back-ends. We can reuse `generateTypesFromJsonSchema`, `normalizeCode` (acorn AST sanitizer), `sanitizeToolName`, and `ToolDispatcher` directly from npm, and only write a **Node-side `Executor` in ~200-400 LOC** that swaps `DynamicWorkerExecutor` for a local sandbox.

Source: [cloudflare/agents/packages/codemode](https://github.com/cloudflare/agents/tree/main/packages/codemode), [docs/codemode.md](https://github.com/cloudflare/agents/blob/main/docs/codemode.md). Also independent OSS port at [jx-codes/codemode-mcp](https://github.com/jx-codes/codemode-mcp) (116★).

**Implication**: the "code-mode" layer is a ~1-day lift, not a ~1-week lift. De-risks the single biggest unknown.

**Confidence: High** on interface shape (verified from docs + source index).

### 3. Sandbox choice narrows to two real options

| Option | Isolation | Perf | Memory cap | Install footprint |
|---|---|---|---|---|
| **isolated-vm** (laverdet) | Real V8 isolate | Native V8 speed | **Soft** — docs say a determined attacker can hit 2-3× limit; OOM may crash host | N-API native compile |
| **quickjs-emscripten** (justjake) | WASM linear memory | ~50× slower than V8 | **Hard** — enforced by WASM runtime | Pure WASM, no native compile |

For short KG query snippets (filter a few hundred rows, RRF merge, project, return), ~50× slower than V8 still lands in sub-10ms. **QuickJS is the structurally stronger choice**: hard memory cap, no native compile (Node/Bun/Deno portable), no filesystem/network/native-module access without explicit capabilities.

**Ruled out definitively**: `vm2` (deprecated 2023, multiple RCE CVEs), `node:vm` (Node docs: "not a security mechanism"), Bun vm (same), `workerd` standalone (Cloudflare's README: not a defense-in-depth boundary).

`assimelha/cmcp` (Rust, ~29★) is direct prior art: local MCP proxy aggregating upstream MCPs behind `search()` + `execute()`, uses QuickJS with 64MB cap, strips TS types via oxc, auto-truncates responses to ~40k chars (~10k tokens).

**Confidence: High** on ruling out the rejected options; **Medium** on QuickJS perf claim (single-source benchmark).

### 4. SQLite substrate: `sqlite-vec` is pre-v1; FTS5 has a shipped regression

- **`sqlite-vec` (7.4k★, v0.1.9 released 2026-03-31)**: pre-v1, README says "expect breaking changes." Brute-force breakpoint ~250K embeddings at 100ms / 1024 dims. ANN/DiskANN in alpha. Pin versions explicitly.
- **FTS5 3.51.0 shipped an ~8.4× performance regression** on prepared statements vs 3.50.4. A WAL-reset bug was also fixed in 3.51.3 (2026-03-13). Pin SQLite patch version too.
- **Trigram tokenizer triples DB size** in real-world testing (1.2 GB → 3.7 GB). `detail='none'` halves it but loses match position data.
- **Vector search has no native snippet/highlight** — the "why did this match?" spend must come from FTS5's `snippet()`. Relevant for budget-shaped responses.
- **Canonical hybrid pattern**: Reciprocal Rank Fusion (RRF) in a single CTE query, FTS5 + sqlite-vec, `rrf_k=60` default. Blessed by sqlite-vec maintainer Alex Garcia.
- **No Node-native SQLite queue library**. `litequeue` is Python-only. If we need a persistent queue we write it on better-sqlite3 ourselves.
- **Concurrency**: `better-sqlite3` + `journal_mode=WAL` + `busy_timeout=5000` + `synchronous=NORMAL` is the accepted recipe. **One writer enforced at the app layer**; separate read pool. Connection pools with multiple writers hurt SQLite throughput.

**Confidence: High** on pragmas and version warnings; **Medium-High** on vector search claims.

### 5. Direct prior art we should study before writing any code

| Project | Stack | Why |
|---|---|---|
| **[obra/knowledge-graph](https://github.com/obra/knowledge-graph)** (57★) | TS + better-sqlite3 + sqlite-vec + FTS5 + MCP | **Closest architectural match.** k-hop, PageRank, community detection, Louvain, centrality all exposed as MCP ops. Uses `@huggingface/transformers` with MiniLM-L6-v2 quantized (22MB). Parses Obsidian vaults into untyped graph. |
| **[tobi/qmd](https://github.com/tobi/qmd)** (20,040★, last push 2026-04-05) | Node + node-llama-cpp + GGUF, CLI + MCP | **Named explicitly in Karpathy's gist.** Implements BM25 + vector + LLM rerank + LLM query expansion + RRF fusion + position-aware blending. On-device. Three modes: `search`, `vsearch`, `query`. |
| **[basicmachines-co/basic-memory](https://github.com/basicmachines-co/basic-memory)** (2,791★) | Python MCP + markdown + FTS + FastEmbed | Direct conceptual competitor. Implements the three-workflow pattern explicitly: `write_note` (ingest), `search_notes` (query), `schema_infer/validate/diff` (lint). `memory://` URIs. Obsidian-compatible. |
| **[lucasastorian/llmwiki](https://github.com/lucasastorian/llmwiki)** (1,594★) | OSS Claude + MCP | Full OSS Karpathy-style implementation. Hosted demo at llmwiki.app. |
| **[jx-codes/codemode-mcp](https://github.com/jx-codes/codemode-mcp)** (116★) | Node | **OSS port of Cloudflare code-mode for local MCP servers.** Unblocks the biggest unknown. |
| **[assimelha/cmcp](https://github.com/assimelha/cmcp)** (~29★) | Rust + QuickJS | Proxy aggregator: search() + execute() over upstream MCPs. Reference for truncation heuristics (~40K chars ≈ 10K tokens). |
| **[Ar9av/obsidian-wiki](https://github.com/Ar9av/obsidian-wiki)** (764★) | Agents + Obsidian | Interesting lint-like pass: tags claims as `extracted` / `^[inferred]` / `^[ambiguous]`. Useful for provenance metadata. |

**Karpathy's wiki is NOT SQLite.** It's a directory of markdown files + `qmd` for hybrid search. Any "SQLite-backed Karpathy" framing is community extrapolation. We should own that design call explicitly: **markdown as canonical, SQLite as index** — exactly matching basic-memory's approach.

### 6. Embeddings: local default + API override

- **Local default**: `nomic-embed-text` (137M params, 768-dim, 8192 context, MTEB 62.39) via Ollama. Pharos already ships Ollama as a Goose provider. Zero new config.
- **Runner-up local**: `mxbai-embed-large-v1` (335M, 1024-dim, MTEB 64.68, retrieval 54.39) if quality matters more than speed.
- **Cheapest API**: OpenAI `text-embedding-3-small` at **$0.02/M tokens**, 768-dim, 8192 context.
- **Best code-specific API**: **Voyage `voyage-code-3`** at $0.18/M tokens (first 200M free/year), 1024-dim Matryoshka, 32K context. +14% over OpenAI text-embedding-3-large on code retrieval.
- **No accurate local Claude tokenizer** for Claude 3+. Must hit `POST /v1/messages/count_tokens` or accept ~10% error with `js-tiktoken p50k_base`. Relevant for our own budget-shaping logic.
- **CoIR** ([github](https://github.com/CoIR-team/coir), [paper](https://arxiv.org/abs/2407.02883)) is the canonical code-retrieval benchmark — ACL 2025, integrated into MTEB Aug 2024. Use it to validate any code embedding choice.

**Recommendation locking later**: default to Ollama + nomic-embed-text; config option for Voyage API key.

**Confidence: High** on pricing (official pages); **High** on benchmarks (MTEB/CoIR).

### 7. MCP transport details

- **Latest spec: 2025-11-25** ([changelog](https://modelcontextprotocol.io/specification/2025-11-25/changelog)). SSE is now deprecated. **Streamable HTTP for remote, stdio for local.**
- **Claude Code uses stdio for local MCP servers**, registered via `~/.claude.json` or `.mcp.json` at the project root, or Pharos via Goose's existing config (which Pharos's "Connections view" will surface per parent presearch).
- **No shared MCP config standard** across Claude Code / Codex / Goose / Cursor. Each agent has its own file format. Not our problem — Pharos only cares about Goose's format.
- **Pagination**: opaque cursors for list ops only. **No streaming or chunking for tool result bodies.** Our `execute()` must self-truncate.
- **Known bug**: Claude Code's `isError: true` handling swallows error content and shows "Error: undefined" to both user and model ([issue 1067](https://github.com/anthropics/claude-code/issues/1067)). Error strings aren't a reliable self-recovery channel yet. Design around this by emitting structured error info inside the normal result payload when possible.
- **2025-06-18 addition: `ResourceLink`** — return URI handles instead of embedded payloads. Candidate escape hatch for responses that would breach the 25K cap.

**Confidence: High** on spec details; **High** on the 25K cap; **Medium** on the isError bug status (may be fixed in latest Claude Code version).

### 8. Code parsing for symbol extraction

- **tree-sitter** (24,587★, active): the baseline. `kreuzberg-dev/tree-sitter-language-pack` bundles **248+ grammars** in one dependency — no longer a per-language install.
- **ts-morph** (6,007★): most complete TS/JS symbol extraction via direct TS compiler API access. Cold start is the known weakness.
- **LSP-as-library**: `vscode-languageserver-node` + `typescript-language-server` for headless type-aware extraction.
- **Parent presearch note**: Pharos POC uses **madge** (file-level) + **Haiku** (function-level for focal file) and explicitly defers tree-sitter + LSP to v1. Our KG-MCP can be tree-sitter-first from day one because we're the v1 layer.

## Gotchas worth flagging in Loop 2

| # | Gotcha | Where it bites |
|---|---|---|
| 1 | Claude Code 25K-token hard cap on tool response | Every read path decision |
| 2 | `isError: true` display bug in Claude Code | Error handling / self-recovery |
| 3 | `sqlite-vec` pre-v1 breaking-change warning | Migration strategy |
| 4 | FTS5 3.51.0 regression + 3.51.x WAL-reset bug | SQLite version pinning in CLAUDE.md |
| 5 | Trigram tokenizer triples DB size | Whether to enable |
| 6 | Vector search has no snippet — FTS5 owns the "why did this match" budget | Hybrid retrieval design |
| 7 | No Node-native SQLite queue library | Build small one on better-sqlite3 |
| 8 | SQLite single-writer rule + connection pools hurt writes | Architecture: single dispatcher writer, separate read pool |
| 9 | No accurate local Claude tokenizer for Claude 3+ | Budget-shaping math |
| 10 | MCP configs are NOT unified across agents | Scope: only Goose format matters for Pharos |
| 11 | Karpathy wiki has no official SQLite implementation | Own the design call explicitly |
| 12 | isolated-vm memoryLimit can be bypassed 2-3× under hostile code | Favor QuickJS hard cap |
| 13 | Pharos wiki-updater rewrites whole files per turn (no diff) | Re-parse + re-index on change; don't optimize for diffs |
| 14 | Privacy invariant: profile updater is the ONLY process that may read `~/.pharos/profile/` | Enforce at MCP handle/binding level, not in the sandbox |
| 15 | Orchestrator queue contract not yet available | Stub with chokidar on `.pharos/wiki/*.md` for the spike |

## Three feasibility-critical unknowns for the spike

Given the "working today" timeline, only three things need to be proven before committing to the full architecture:

1. **Does code-mode sandboxing actually work locally at acceptable latency?**
   Fork `jx-codes/codemode-mcp` and/or drop `@cloudflare/codemode` into a Node process with a QuickJS executor. Measure: cold sandbox spawn, filter-and-project cost on ~500 markdown chunks, end-to-end `search(q)` call through MCP stdio.

2. **Can we stay under the 25K-token cap on realistic wiki data?**
   Point the prototype at one of Pharos's fixture repos (or run `qmd` against `.pharos/wiki/` from a real Pharos session). Measure actual returned token sizes for typical queries. Prove we can budget-shape to <5K tokens per response without losing relevance.

3. **Does markdown-as-canonical + SQLite-as-index survive the Pharos integration seam?**
   Watch `.pharos/wiki/*.md` with chokidar, re-parse on change, insert into FTS5 + sqlite-vec, run search from an MCP client. Prove the round-trip works end-to-end without blocking Pharos's existing write path.

**If all three work**, the full architecture (personal/project bridge, lint pass, queue subscriber, Haiku-driven gap filling) is straightforward engineering. **If any fails**, we have a concrete blocker to escalate.

## Sources (key references only; agent reports contain 85+ total)

**Spec & protocol**: https://code.claude.com/docs/en/mcp · https://modelcontextprotocol.io/specification/2025-11-25/changelog · https://github.com/modelcontextprotocol/typescript-sdk · https://github.com/orgs/community/discussions/169224 (25K cap)

**Code-mode**: https://blog.cloudflare.com/code-mode/ · https://blog.cloudflare.com/code-mode-mcp/ · https://github.com/cloudflare/agents/tree/main/packages/codemode · https://github.com/jx-codes/codemode-mcp · https://workos.com/blog/cloudflare-code-mode-cuts-token-usage-by-81

**Sandbox**: https://github.com/laverdet/isolated-vm · https://github.com/justjake/quickjs-emscripten · https://github.com/assimelha/cmcp · https://github.com/nodejs/node/blob/main/doc/api/vm.md · https://snyk.io/blog/security-concerns-javascript-sandbox-node-js-vm-module/

**SQLite**: https://www.sqlite.org/fts5.html · https://www.sqlite.org/wal.html · https://github.com/asg017/sqlite-vec · https://alexgarcia.xyz/blog/2024/sqlite-vec-hybrid-search/ · https://github.com/liamca/sqlite-hybrid-search

**Prior art**: https://github.com/obra/knowledge-graph · https://github.com/tobi/qmd · https://github.com/basicmachines-co/basic-memory · https://github.com/lucasastorian/llmwiki

**Karpathy**: https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f

**Embeddings**: https://blog.voyageai.com/2024/12/04/voyage-code-3/ · https://docs.voyageai.com/docs/pricing · https://openai.com/api/pricing/ · https://huggingface.co/BAAI/bge-m3 · https://github.com/CoIR-team/coir

**Pharos parent docs**: `~/dev/gauntlet/pharos/docs/PRESEARCH.md` · `~/dev/gauntlet/pharos/docs/ARCHITECTURE.md` · `~/dev/gauntlet/pharos/docs/POC_PRD.md` · `~/dev/gauntlet/pharos/desktop/evals/14-wiki-updater-drift.eval.ts`
