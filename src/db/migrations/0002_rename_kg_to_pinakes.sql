-- Rename all kg_* tables to pinakes_* (clean break for v0.2.0 → v0.3.0)
-- Regular tables use ALTER TABLE RENAME. Virtual tables need special handling.

-- Step 1: Rename regular tables
ALTER TABLE `kg_audit` RENAME TO `pinakes_audit`;--> statement-breakpoint
ALTER TABLE `kg_chunks` RENAME TO `pinakes_chunks`;--> statement-breakpoint
ALTER TABLE `kg_edges` RENAME TO `pinakes_edges`;--> statement-breakpoint
ALTER TABLE `kg_gaps` RENAME TO `pinakes_gaps`;--> statement-breakpoint
ALTER TABLE `kg_log` RENAME TO `pinakes_log`;--> statement-breakpoint
ALTER TABLE `kg_meta` RENAME TO `pinakes_meta`;--> statement-breakpoint
ALTER TABLE `kg_nodes` RENAME TO `pinakes_nodes`;--> statement-breakpoint

-- Step 2: Drop old FTS5 triggers (they reference the old table names)
DROP TRIGGER IF EXISTS `kg_chunks_fts_ai`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `kg_chunks_fts_ad`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `kg_chunks_fts_au`;--> statement-breakpoint

-- Step 3: Drop and recreate FTS5 virtual table with new content table name
DROP TABLE IF EXISTS `kg_chunks_fts`;--> statement-breakpoint

CREATE VIRTUAL TABLE `pinakes_chunks_fts` USING fts5(
  text,
  content='pinakes_chunks',
  content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2'
);--> statement-breakpoint

-- Step 4: Recreate FTS5 sync triggers with new names
CREATE TRIGGER `pinakes_chunks_fts_ai` AFTER INSERT ON `pinakes_chunks` BEGIN
  INSERT INTO `pinakes_chunks_fts`(`rowid`, `text`) VALUES (new.`rowid`, new.`text`);
END;--> statement-breakpoint

CREATE TRIGGER `pinakes_chunks_fts_ad` AFTER DELETE ON `pinakes_chunks` BEGIN
  INSERT INTO `pinakes_chunks_fts`(`pinakes_chunks_fts`, `rowid`, `text`) VALUES('delete', old.`rowid`, old.`text`);
END;--> statement-breakpoint

CREATE TRIGGER `pinakes_chunks_fts_au` AFTER UPDATE ON `pinakes_chunks` BEGIN
  INSERT INTO `pinakes_chunks_fts`(`pinakes_chunks_fts`, `rowid`, `text`) VALUES('delete', old.`rowid`, old.`text`);
  INSERT INTO `pinakes_chunks_fts`(`rowid`, `text`) VALUES (new.`rowid`, new.`text`);
END;--> statement-breakpoint

-- Step 5: Recreate sqlite-vec virtual table (ALTER TABLE RENAME doesn't
-- rename vec0's internal shadow tables, so we must drop+create+copy)
CREATE VIRTUAL TABLE `pinakes_chunks_vec` USING vec0(embedding FLOAT[384]);--> statement-breakpoint
INSERT INTO `pinakes_chunks_vec`(`rowid`, `embedding`) SELECT `rowid`, `embedding` FROM `kg_chunks_vec`;--> statement-breakpoint
DROP TABLE IF EXISTS `kg_chunks_vec`;--> statement-breakpoint

-- Step 6: Repopulate FTS5 index from renamed chunks table
INSERT INTO `pinakes_chunks_fts`(`rowid`, `text`) SELECT `rowid`, `text` FROM `pinakes_chunks`;
