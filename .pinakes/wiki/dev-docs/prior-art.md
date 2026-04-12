# Prior art — what we're taking from each

> Phase 0 deliverable. Read before writing any of our own code. For each
> project, document (a) what it does, (b) what we're stealing, (c) what
> we're deliberately NOT using and why.

_Last read: 2026-04-08_

## 1. jx-codes/codemode-mcp

A local MCP server that exposes a single `execute_code` tool, converting the LLM's tool-calling problem into a code-generation problem. Uses Deno sandbox to run TypeScript/JavaScript with HTTP-only network access, proxying MCP server calls through an HTTP endpoint.

**Taking from this:**
- **Code-as-orchestration pattern.** LLMs are better at writing code than parsing tool schemas. Single tool (`execute_code`) that accepts code blocks.
- **HTTP proxy architecture.** MCP servers are launched as subprocesses; code in sandbox makes `fetch()` calls to `http://localhost:3001/mcp/*` endpoints rather than receiving tool bindings directly. Keeps the sandbox simpler and more testable.
- **Permission model:** Hardcoded safe permissions (`HARDCODED_PERMISSIONS = ["net"]`). No filesystem, no environment variable access from sandbox.
- **Config discovery.** Searches multiple directories for `.mcp.json` files; allows operator to compose servers without modifying the tool.

**Not taking:**
- **Deno as the runtime.** We need Node.js compatibility (Phase 1 uses QuickJS or isolated-vm). Deno adds another runtime dependency.
- **The proxy indirection.** Our sandbox will receive tool bindings directly; no HTTP layer. Reduces latency and complexity.
- **Dependency on subprocess MCP clients.** We'll index our KG once at startup, not proxy through running servers.

---

## 2. obra/knowledge-graph

Parses an Obsidian vault into an untyped graph (files = nodes, wiki links = edges), indexes into SQLite with vector embeddings (Xenova/all-MiniLM-L6-v2, 22MB, local) and FTS5. Exposes 10 CLI operations: search, traverse (paths/neighbors), analyze (Louvain communities, betweenness, PageRank).

**Taking from this:**
- **YAML frontmatter + markdown as canonical.** Uses `gray-matter` to extract frontmatter gracefully (fallback on malformed YAML). Treats the `.md` file as both human-readable and machine-queryable.
- **Wiki link extraction and resolution.** Parses `[[links]]`, resolves to shortest unique path (Obsidian's algorithm), creates stubs for dangling links. Edge context is the enclosing paragraph.
- **Incremental indexing by mtime.** Only re-process changed files; tracks file modification times. Fast re-index on large vaults.
- **SQLite + sqlite-vec + FTS5 stack.** Single file, local, no cloud. Vector embeddings for semantic search; FTS5 for full-text. BigInt rowid requirement noted.

**Not taking:**
- **Graphology for in-memory analysis.** We'll offload graph algorithms to SQLite queries (CTEs, BFS via recursive queries). Lighter footprint; no need to materialize the full graph in RAM.
- **Obsidian-specific link semantics.** Our wiki links will use simpler matching (no directory-aware disambiguation). Lower complexity, adequate for two-level KG.
- **Community detection (Louvain) as a first-class operation.** Not in our Phase 0 scope. We focus on ingest, index, search, and code-execution, not graph analysis.

---

## 3. tobi/qmd

On-device semantic search for markdown notes. Combines BM25 (keyword), vector (embedding via `embeddinggemma`), and LLM re-ranking (via `node-llama-cpp`). Exposes 4 MCP tools: `query` (typed sub-queries: lex/vec/hyde), `get`, `multi_get`, `status`.

**Taking from this:**
- **Reciprocal Rank Fusion (RRF).** Multiple retrieval strategies (BM25, vector, optional HYDE synthetic query expansion) scored and fused via RRF before final ranking. BM25 and vector search are orthogonal; RRF combines them without LLM overhead when desired.
- **Smart chunking with break-point detection.** Splits markdown at headings (h1=100pts, h2=90, h3=80), blank lines, etc., preferring natural boundaries. 900-token chunks with 15% overlap, respecting code fences. Prevents splitting inside code blocks.
- **Per-collection context tags.** Each document can carry tags or metadata; search results annotate which collection matched. Helps LLMs disambiguate results.
- **Embedder choice: gguf-based inference.** Uses `node-llama-cpp` with quantized GGUF models (no external API, local inference, ~100ms per document).

**Not taking:**
- **Full LLM re-ranking as the search default.** Phase 0 uses BM25 + vector RRF; re-ranking is optional, deferred to Phase 1+. Keeps initial search fast and determinate.
- **HYDE (Hypothetical Document Expansion).** Too expensive for Phase 0. RRF fusion of BM25 and vector is sufficient.
- **CLI-first output formatting.** We're MCP-native from the start. No need for the `--json`, `--files` CLI export modes.

---

## 4. basicmachines-co/basic-memory

Python MCP server. Writes and reads persistent Markdown knowledge stored in local files. Structured notes with frontmatter (`title`, `permalink`, `tags`, `relations`). Three core workflows: **Read** (search, view note), **Write** (create, append, edit), **Relate** (link entities, traverse graph).

**Taking from this:**
- **Workflow taxonomy: Read / Write / Relate.** Clarifies the three axes of operation. Our Phase 1 will map similarly: **Index** (parse markdown → SQLite), **Query** (search + traverse), **Execute** (LLM code in sandbox).
- **Markdown folder structure conventions.** Notes live in flat `~/$PROJECT/` directory. Permalinks decouple display names from file paths. Supports watching via `fswatch` / `chokidar` for real-time sync.
- **Semantic pattern in markdown:** Relations via inline links (`[[link]]`), observations in bullet lists (`- [category] text`), categories as scoped tags. Human-readable, LLM-parseable.
- **Bidirectional sync readiness.** File system is canonical; cloud sync is optional. Aligns with our markdown-as-canonical design.

**Not taking:**
- **Per-project cloud routing.** Not in scope. We stay local-first.
- **Schema inference / validation tools.** Deferred to Phase 2+. Phase 0 accepts freeform markdown.
- **Complex entity resolution.** Basic Memory does fuzzy matching and aliasing. We defer this; simple exact match + wiki-link-style resolution is sufficient.

---

## 5. @cloudflare/codemode — vendoring audit (VENDORED 2026-04-08)

The main entry (`index.js`) imports `RpcTarget` from `cloudflare:workers` — a Workers-runtime-only binding. **The published package cannot be imported from Node.js directly.** This made the "vendoring fallback" from presearch.md §2.2 the only viable path, not a contingency. **Status: done — see `src/sandbox/vendored-codemode.ts` and presearch.md D30.**

### What we vendored

| Function | Purpose | Upstream chunk file |
|---|---|---|
| `normalizeCode(code)` | Strip markdown fences, parse with acorn, wrap LLM output as async IIFE. Graceful fallback if parse fails. | `resolve-DIQRkRqQ.js` |
| `sanitizeToolName(name)` | Convert tool names like `pinakes-search` to valid JS identifiers (`pinakes_search`), handle reserved words (`class` → `class_`), digit-leading (`123x` → `_123x`). | `json-schema-types-DoQ0VISs.js` |
| `jsonSchemaToType(schema, typeName)` | Convert a JSON Schema to a TypeScript `type` alias string. Handles `$ref`, `anyOf`/`oneOf`/`allOf`, `enum`, `const`, arrays (including tuples via `prefixItems`), objects, `additionalProperties`, OpenAPI `nullable`, and cycles via depth-limited traversal. | `json-schema-types-DoQ0VISs.js` |
| `generateTypesFromJsonSchema(tools)` | Build the `declare const codemode: { ... }` block that we'll stuff into the `execute` tool description so the LLM sees typed tool signatures. | `json-schema-types-DoQ0VISs.js` |

Plus the private helpers they transitively need (`toPascalCase`, `escapeJsDoc`, `escapeStringLiteral`, `escapeControlChar`, `quoteProp`, `resolveRef`, `applyNullable`, `jsonSchemaToTypeString`, `extractJsonSchemaDescriptions`) and the 67-entry `JS_RESERVED` keyword set.

### What we did NOT vendor

- `DynamicWorkerExecutor` class — it extends `RpcTarget from "cloudflare:workers"` and uses Workers RPC to dispatch tool calls across an isolate boundary. **We write our own QuickJS-backed `Executor` implementation** in `src/sandbox/executor.ts` (Phase 1+) that satisfies the same interface.
- `ToolDispatcher` class — same reason (Workers RPC).
- `resolveProvider` — we'll write a simpler version when Phase 3's full code-mode surface lands; the upstream version is entangled with the AI SDK's `ToolSet` type.

### Executor interface (retained verbatim)

The interface below is the contract any sandbox implementation must satisfy. Phase 1's QuickJS spike implements it directly; Phase 3 promotes the spike's impl to the warm-pool version.

```typescript
interface ExecuteResult { result: unknown; error?: string; logs?: string[]; }
interface ResolvedProvider {
  name: string;
  fns: Record<string, (...args: unknown[]) => Promise<unknown>>;
  positionalArgs?: boolean;
}
interface Executor {
  execute(
    code: string,
    providersOrFns: ResolvedProvider[] | Record<string, (...args: unknown[]) => Promise<unknown>>
  ): Promise<ExecuteResult>;
}
```

### Size accounting

| Measure | LOC |
|---|---|
| Upstream dist chunks combined (`resolve-*.js` + `json-schema-types-*.js`, minus the unused `resolve.ts` tool-provider helpers) | ~285 |
| Our `src/sandbox/vendored-codemode.ts` with proper TypeScript types, JSDoc, exported interfaces, MIT attribution block, and whitespace | **557** |
| Upstream 400 LOC "loose" budget from presearch.md §2.2 | 400 |

We're over the strict budget but the user explicitly flagged the budget as loose, and the inflation is entirely comment block + explicit type annotations + blank lines. Executable statements remain under 300.

### Dependency changes

- `@cloudflare/codemode` — **removed** from `package.json`.
- `acorn@^8.16.0` — **added as a direct `dependencies` entry** (previously a transitive dep of codemode; needed directly by `normalizeCode`).
- `@types/json-schema@^7.0.15` — **added as a direct `devDependencies` entry** (previously transitive via eslint; needed for `JSONSchema7` types in the vendored file).

### Attribution

Full MIT license notice is inlined at the top of `src/sandbox/vendored-codemode.ts`. Upstream copyright: Cloudflare, Inc. Source repo: https://github.com/cloudflare/agents/tree/main/packages/codemode.

---

## Implementation Roadmap Summary

Phase 0 is scaffold only — nothing in this list is wired up yet. This summary reflects what the phases documented in `PRD.md` will wire in, not what exists today.

- **Parser (Phase 2):** `micromark` + `mdast-util-from-markdown` per locked stack (presearch.md §2.2). Wiki-link extraction adapted from obra/knowledge-graph's paragraph-context approach, implemented as a custom `mdast` visitor. We explicitly do NOT use `gray-matter` — frontmatter support, if needed, will be added via a `micromark` extension.
- **Indexer (Phase 2):** SQLite (3.51.3, bundled with `better-sqlite3` 12.8.0) + `sqlite-vec` 0.1.9 + FTS5 with `unicode61 remove_diacritics 2` tokenizer.
- **Search (Phase 4):** BM25 (FTS5) + vector (sqlite-vec) fused via Alex Garcia's single-CTE RRF pattern (qmd-style, rrf_k=60). No LLM re-ranking in MVP.
- **Sandbox (Phase 1 + 3):** 4 vendored pure-JS utilities from `@cloudflare/codemode` + our own Node-compatible `Executor` implementation over `quickjs-emscripten` 0.32.0. See §5 for the vendoring plan.
- **Code Mode (Phase 3):** `Executor` interface shape reused verbatim from the vendoring audit; bindings injected per-call based on the `scope` param (privacy invariant enforced at the dispatcher, not inside the sandbox).

Deferred in MVP: graph algorithms, multi-device sync, LLM re-rank, entity resolution beyond wiki-link dedup. Focus: reliable ingest → fast local hybrid retrieval → budget-shaped code execution.
