/**
 * Shared types for KG-MCP query results.
 *
 * Phase 2 introduces this file to decouple the tool handlers from any
 * single store implementation. Phase 1's `MemoryStore` defined `Chunk`
 * inline; Phase 2's `Repository` returns the same shape, and the tool
 * handlers import from here. When `MemoryStore` is deleted in Pass 4
 * step 32, this file becomes the canonical source.
 */

export type Scope = 'project' | 'personal' | 'both';

/**
 * A retrieval-shaped chunk. Mirrors what Phase 1's `MemoryStore` returned
 * so the existing 13 spike tests stay green across the swap. Field shape
 * is locked — adding fields is fine; renaming/removing breaks the
 * sandbox host bindings (`kg.search` returns `{id, text, source_uri}`)
 * and the spike test asserting that shape.
 */
export interface Chunk {
  /** Deterministic id — Phase 1: sha1(`relative_path:index`); Phase 2: sha1(`node_id:chunk_index`) */
  id: string;
  /** Chunk text content (paragraph(s) up to the chunker's target token count) */
  text: string;
  /** `file://` URL of the source markdown file */
  source_uri: string;
  /** 0-based position within the source node's chunk list */
  chunk_index: number;
}
