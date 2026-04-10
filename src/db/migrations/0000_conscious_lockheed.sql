CREATE TABLE `kg_audit` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ts` integer NOT NULL,
	`tool_name` text NOT NULL,
	`scope_requested` text NOT NULL,
	`caller_ctx` text,
	`response_tokens` integer,
	`error` text
);
--> statement-breakpoint
CREATE TABLE `kg_chunks` (
	`id` text PRIMARY KEY NOT NULL,
	`node_id` text NOT NULL,
	`chunk_index` integer NOT NULL,
	`text` text NOT NULL,
	`chunk_sha` text NOT NULL,
	`token_count` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`node_id`) REFERENCES `kg_nodes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_kg_chunks_node` ON `kg_chunks` (`node_id`);--> statement-breakpoint
CREATE TABLE `kg_edges` (
	`src_id` text NOT NULL,
	`dst_id` text NOT NULL,
	`edge_kind` text NOT NULL,
	PRIMARY KEY(`src_id`, `dst_id`, `edge_kind`),
	FOREIGN KEY (`src_id`) REFERENCES `kg_nodes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`dst_id`) REFERENCES `kg_nodes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_kg_edges_src` ON `kg_edges` (`src_id`);--> statement-breakpoint
CREATE INDEX `idx_kg_edges_dst` ON `kg_edges` (`dst_id`);--> statement-breakpoint
CREATE TABLE `kg_gaps` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`scope` text NOT NULL,
	`topic` text NOT NULL,
	`first_seen_at` integer NOT NULL,
	`mentions_count` integer DEFAULT 1 NOT NULL,
	`resolved_at` integer
);
--> statement-breakpoint
CREATE TABLE `kg_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ts` integer NOT NULL,
	`scope` text NOT NULL,
	`kind` text NOT NULL,
	`source_uri` text,
	`payload` text
);
--> statement-breakpoint
CREATE INDEX `idx_kg_log_ts` ON `kg_log` ("ts" DESC);--> statement-breakpoint
CREATE TABLE `kg_meta` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text
);
--> statement-breakpoint
CREATE TABLE `kg_nodes` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`source_uri` text NOT NULL,
	`section_path` text NOT NULL,
	`kind` text DEFAULT 'section' NOT NULL,
	`title` text,
	`content` text NOT NULL,
	`source_sha` text NOT NULL,
	`token_count` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`last_accessed_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_kg_nodes_scope_uri` ON `kg_nodes` (`scope`,`source_uri`);--> statement-breakpoint
CREATE INDEX `idx_kg_nodes_last_accessed` ON `kg_nodes` (`last_accessed_at`);--> statement-breakpoint

-- ============================================================================
-- Virtual tables (drizzle-kit doesn't emit these — appended by hand)
-- ============================================================================

-- FTS5 over kg_chunks. External-content table: the FTS5 index references
-- rows in kg_chunks by rowid, so we don't pay for duplicate text storage.
-- Tokenizer: unicode61 with diacritics removal. NOT trigram (CLAUDE.md
-- §Database Rules #9 — trigram triples DB size, presearch.md §Loop 0 gotcha).
-- Phase 2 only populates this via the triggers below; the FTS5 query path
-- itself lands in Phase 4 (currently the repository uses LIKE).
CREATE VIRTUAL TABLE `kg_chunks_fts` USING fts5(
  text,
  content='kg_chunks',
  content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2'
);--> statement-breakpoint

-- Sync triggers — every kg_chunks insert/delete/update mirrors into kg_chunks_fts.
-- The 'delete' marker rows are how external-content FTS5 tables handle deletes.
CREATE TRIGGER `kg_chunks_fts_ai` AFTER INSERT ON `kg_chunks` BEGIN
  INSERT INTO `kg_chunks_fts`(`rowid`, `text`) VALUES (new.`rowid`, new.`text`);
END;--> statement-breakpoint

CREATE TRIGGER `kg_chunks_fts_ad` AFTER DELETE ON `kg_chunks` BEGIN
  INSERT INTO `kg_chunks_fts`(`kg_chunks_fts`, `rowid`, `text`) VALUES('delete', old.`rowid`, old.`text`);
END;--> statement-breakpoint

CREATE TRIGGER `kg_chunks_fts_au` AFTER UPDATE ON `kg_chunks` BEGIN
  INSERT INTO `kg_chunks_fts`(`kg_chunks_fts`, `rowid`, `text`) VALUES('delete', old.`rowid`, old.`text`);
  INSERT INTO `kg_chunks_fts`(`rowid`, `text`) VALUES (new.`rowid`, new.`text`);
END;--> statement-breakpoint

-- sqlite-vec virtual table for chunk embeddings. 384 dims is the MiniLM
-- output size. If we ever swap embedders to a different dim, this table
-- must be dropped and re-created and all chunks re-embedded — that's a
-- distinct migration path stamped via kg_meta.schema_version.
-- Joins to kg_chunks via rowid.
-- Requires sqlite-vec extension to be loaded on the connection BEFORE this
-- statement runs; src/db/client.ts loads it before invoking migrate().
CREATE VIRTUAL TABLE kg_chunks_vec USING vec0(embedding FLOAT[384]);