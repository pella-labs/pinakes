# GBrain vs Pinakes — Comparative Analysis

> Source: [github.com/garrytan/gbrain](https://github.com/garrytan/gbrain) (v0.5.0, created 2026-04-05, 3.2K stars)
> Author: Garry Tan (Y Combinator president), built for daily use with OpenClaw AI agent.
> Analysis date: 2026-04-11

---

## TL;DR

GBrain is a personal knowledge brain (memex) that indexes markdown from a git repo into Postgres + pgvector. It shares our "markdown canonical, DB is index" philosophy but takes the opposite approach on almost every design axis: maximalist tool surface (30 tools vs our 2), cloud-first infrastructure (Postgres + OpenAI + Supabase vs our local-first SQLite + bundled embeddings), and no sandbox/code-mode. The most extractable ideas are its **multi-query expansion**, **semantic chunking via Savitzky-Golay**, **compiled-truth + timeline page structure**, **contract-first operation definitions**, and **4-layer dedup pipeline**.

---

## What's Similar

### Shared philosophy
- **Markdown is canonical, DB is the index.** Both projects treat markdown files in a directory as the source of truth and the database as a rebuild-from-scratch retrieval index. This is the Karpathy wiki thesis.
- **Hybrid retrieval.** Both use vector search + keyword search + RRF fusion to merge results.
- **Content hashing for idempotent ingest.** GBrain uses SHA-256; we use SHA-1. Both skip re-processing unchanged content.
- **Embedding failure is non-fatal.** Both degrade gracefully to keyword-only search when the embedder fails.
- **Staleness detection.** Both flag when query results may be stale relative to disk.
- **Single canonical engine implementation.** GBrain has one `PostgresEngine` class; we have our single-writer `better-sqlite3` connection. Both avoid over-abstracted adapter layers.
- **Deterministic IDs.** Both derive node/page IDs from content identity (scope+uri+path for us, slug for GBrain).
- **Audit logging.** Both log every tool invocation for observability.

### Shared stack elements
- TypeScript
- `@modelcontextprotocol/sdk` for MCP server
- gray-matter / frontmatter parsing (they use `gray-matter`, we use `micromark` + `mdast`)
- Stdio transport for local MCP

---

## What's Different

| Dimension | GBrain | Pinakes |
|---|---|---|
| **Runtime** | Bun | Node 24 LTS |
| **Database** | Postgres + pgvector (1536d HNSW) | SQLite + sqlite-vec (384d) + FTS5 |
| **Embeddings** | OpenAI `text-embedding-3-large` (requires API key, always) | Bundled transformers.js MiniLM (zero config), optional Ollama/Voyage/OpenAI |
| **MCP tool count** | 30 individual tools (one per operation) | 2 tools (`search` + `execute`) via code-mode |
| **Code-mode sandbox** | None — each operation is a separate tool call | QuickJS sandbox with vendored Cloudflare code-mode |
| **Scope model** | Single personal brain, no scoping | Project + personal scopes with strict privacy invariant |
| **Budget gate** | None — results returned as-is | 25K-token hard cap, js-tiktoken, greedy truncation by RRF rank |
| **Query expansion** | Claude Haiku generates 2 alternative phrasings per query | None |
| **Chunking** | 3-tier: recursive + Savitzky-Golay semantic + LLM-guided | Recursive delimiter-aware only |
| **Deployment** | Local CLI + remote Supabase Edge Function with bearer auth | Local stdio only (client-agnostic) |
| **File attachments** | S3/Supabase Storage with content-hash dedup | None |
| **Page structure** | Compiled-truth zone + timeline zone per page | Flat markdown sections |
| **Graph traversal** | Recursive CTE to arbitrary depth with JSONB aggregates | Edge table with direct queries |
| **Watch mechanism** | Git-based polling every 60s (`gbrain sync --watch`) | chokidar file watcher with 2s debounce |
| **Dream cycle** | Nightly autonomous enrichment via cron | None (gap detection planned for Phase 8) |
| **Process model** | Connection pool of 10 to Postgres | Single writer + 2-reader pool to SQLite |
| **Auth** | Bearer tokens (SHA-256 hashed) in DB for remote MCP | None (local stdio, no remote) |
| **Dependencies** | Lean (~10 direct deps) | Moderate (~15 direct deps) |
| **Entity types** | 9 typed page kinds (person, company, deal, concept...) | Untyped nodes |
| **Versioning** | Page snapshot history with revert | None |

### Key architectural divergences

1. **Tool surface philosophy.** GBrain is maximalist (30 tools = 30 schemas in context). Pinakes is minimalist (2 tools, code-mode compresses the schema). GBrain pays the token cost of 30 tool descriptions on every conversation turn; we pay 2. Their approach is simpler to implement but burns more context window. Our approach is more complex (QuickJS sandbox) but far cheaper on tokens.

2. **Infrastructure gravity.** GBrain requires Postgres, pgvector, and an OpenAI API key to function at all. It's designed for Supabase-managed infrastructure. Pinakes is fully local — zero external dependencies in default mode. This is a fundamental design choice, not an oversight: GBrain targets a power user (Garry) with infrastructure budget; we target any developer with `pnpm install`.

3. **Privacy model.** GBrain has no concept of scope separation. All data lives in one Postgres database. Pinakes enforces a hard privacy invariant between project and personal scopes, with a 15-test adversarial suite as a merge blocker. This is non-negotiable for our use case where personal KG data must never leak into a project repo.

4. **LLM on the query path.** GBrain calls Claude Haiku on every hybrid search for query expansion. We explicitly forbid LLM calls on the query path (CLAUDE.md: "We don't call LLMs on the query path"). Their approach gets better recall at the cost of latency, cost, and an external dependency on every read.

---

## What We Could Extract as Improvements

### High-value, low-effort

#### 1. Multi-query expansion (Phase 8 candidate)
GBrain uses Claude Haiku to generate 2 alternative phrasings per query, then runs keyword + vector search for all variants and merges via RRF. This significantly improves recall for ambiguous or jargon-heavy queries. **We could offer this as an opt-in mode** (e.g., `expand: true` param on `search`) gated behind an API key, keeping our "no LLM on query path by default" invariant intact. The expansion is non-fatal in GBrain — if Haiku fails, it falls back to the original query only.

**Effort**: Small. Add an optional `expand` boolean to `search`, call Haiku for 2 alt phrasings, run existing hybrid search 3x, merge with existing RRF. ~100 LOC.

#### 2. 4-layer dedup pipeline
GBrain's dedup is more sophisticated than ours:
- Layer 1: Top 3 chunks per page (by score) — prevents one page dominating results
- Layer 2: Jaccard text similarity > 0.85 removal — catches near-duplicate content across pages
- Layer 3: Type diversity — no page type exceeds 60% of results
- Layer 4: Cap at 2 chunks per page

We should adopt at least Layers 1 and 2. Layer 3 requires typed nodes (not currently in our model). Layer 4 is a stricter version of Layer 1.

**Effort**: Small. Add post-RRF dedup in `src/retrieval/hybrid.ts`. ~50 LOC.

#### 3. Contract-first operation definitions
GBrain defines all 30 operations in a single `operations.ts` with schema, handler, CLI hints, and mutation flag. Both CLI and MCP server are auto-generated from this single source. This eliminates drift between CLI and MCP. We have a similar but less formal pattern — our tool definitions in `src/mcp/tools/` and CLI in `src/cli/` are separate. Adopting a single operation registry would be cleaner.

**Effort**: Medium. Refactor tool definitions + CLI into a shared operation registry. ~200 LOC refactor.

### Medium-value, medium-effort

#### 4. Savitzky-Golay semantic chunking
GBrain's semantic chunker embeds every sentence, computes pairwise cosine similarity of adjacent sentences, applies a Savitzky-Golay filter (5-window, 3rd-order polynomial) to smooth the similarity curve, then finds local minima (topic boundaries) via zero-crossings of the first derivative. This produces much more coherent chunks than fixed-size splitting for long-form content.

We currently use recursive delimiter-aware chunking. Adding a semantic chunking option (used when embedder is available) would improve retrieval quality, especially for long wiki pages that cover multiple topics.

**Effort**: Medium. Implement Savitzky-Golay filter + sentence embedding + boundary detection. ~300 LOC. Requires embedding each sentence at ingest time (more API/compute cost).

**Trade-off**: More expensive at ingest time (embed every sentence, not just every chunk). Could be opt-in for project KG only, skipped for personal KG where the 5K-chunk LRU cap already constrains size.

#### 5. Compiled-truth + timeline page structure
GBrain's two-zone page structure is compelling:
- **Above the `---`**: Compiled truth — always-current, synthesized, rewritten as evidence changes
- **Below the `---`**: Timeline — append-only, reverse-chronological evidence with inline citations

This maps directly to Karpathy's wiki spec and creates a natural separation between "what I know now" and "how I learned it." We could adopt this as a **convention** (documented in wiki templates) without requiring code changes. The ingest pipeline would need minor changes to weight compiled-truth sections higher in search results (similar to GBrain's tsvector weight A=title, B=compiled_truth, C=timeline).

**Effort**: Low for convention, medium for weighted search. ~100 LOC to add section-aware weighting in `src/retrieval/fts.ts`.

#### 6. Page versioning / snapshot history
GBrain snapshots `compiled_truth` on every update to `page_versions` with revert capability. This is useful for the write path — when the LLM rewrites a wiki page, you can always go back. We don't currently track versions beyond what git provides.

**Effort**: Medium. Add `pinakes_node_versions` table + snapshot on write. ~150 LOC + migration.

**Trade-off**: Git already provides version history for the canonical markdown. This is only useful if you want in-tool revert without git CLI. Probably not worth it given our "markdown is canonical" stance — `git log` + `git checkout` already do this.

### Lower-value or doesn't fit our model

#### 7. Dream cycle (autonomous enrichment)
GBrain runs a nightly cron that scans conversations, enriches entities, fixes citations, and consolidates memory. This is interesting but violates our "no LLM on the data path" principle and requires significant infrastructure (cron, API keys, conversation history access). Our Phase 8 gap-detection sub-agent is a lighter version of this, rate-limited to 1 call/hour.

**Verdict**: Watch but don't adopt. Our gap-detection approach in Phase 8 is more conservative and better fits our local-first model.

#### 8. Remote MCP deployment
GBrain deploys as a Supabase Edge Function with bearer token auth and Hono web framework. This is useful for multi-device access but contradicts our local-first, single-process, client-agnostic design. If we ever need remote access, SSE transport is the MCP-native answer.

**Verdict**: Not applicable to our architecture. File for future reference if remote access becomes a requirement.

#### 9. 30-tool surface
GBrain exposes 30 individual tools. This is architecturally simpler (no sandbox) but burns massive context on every conversation turn. Our 2-tool code-mode approach is a deliberate, researched decision (presearch.md). GBrain's approach validates that the "many tools" pattern works, but at a token cost we've explicitly chosen to avoid.

**Verdict**: Confirms our code-mode decision was right. Their 30-tool approach works for a single power user with large context windows, but doesn't scale to the general case.

#### 10. Typed entities (person, company, concept, etc.)
GBrain has 9 page types with type-specific frontmatter and directory conventions. This enables type-diversity dedup (Layer 3) and smarter entity resolution. Our nodes are untyped. Adding types would be useful but is a significant schema change.

**Verdict**: Consider for post-v1 if entity resolution becomes important. Not needed for MVP.

---

## Summary of Recommendations

| Idea | Priority | Effort | Phase |
|---|---|---|---|
| Multi-query expansion (opt-in) | High | Small | 8 (stretch) |
| 4-layer dedup pipeline (Layers 1+2) | High | Small | 8 |
| Contract-first operation registry | Medium | Medium | 8 |
| Savitzky-Golay semantic chunking (opt-in) | Medium | Medium | Post-v1 |
| Compiled-truth + timeline convention | Medium | Low | 8 (docs only) |
| Section-aware FTS weighting | Medium | Medium | Post-v1 |
| Page versioning | Low | Medium | Not recommended (git suffices) |
| Dream cycle | Low | Large | Not recommended |
| Remote MCP | Low | Large | Not applicable |
| Typed entities | Low | Large | Post-v1 |

---

## Notable Technical Details Worth Knowing

- **Advisory locks for schema init**: GBrain uses `SELECT pg_advisory_lock(42)` to prevent concurrent DDL deadlocks. We don't need this (single writer), but it's a good pattern if we ever add concurrent startup paths.

- **COALESCE trick for embedding preservation**: Their chunk upsert uses `COALESCE(EXCLUDED.embedding, content_chunks.embedding)` to preserve existing embeddings when re-importing text. We do something similar with `chunk_sha` skip-unchanged, but their approach is more elegant at the SQL level.

- **Batch embedding with backoff**: They batch embed 100 chunks at a time with exponential backoff (4s base, 120s cap, 5 retries) and respect `Retry-After` headers. We should adopt this pattern for our Voyage/OpenAI embedder paths.

- **`bun build --compile`**: They compile the entire app into a single binary. If we ever want a zero-dep distribution, this is worth studying (though we're on Node, not Bun).

- **OpenClaw plugin manifest**: GBrain ships as a "ClawHub bundle" plugin with 7 skills. This is agent-framework-specific packaging — interesting as a distribution model but not applicable to our client-agnostic stance.
