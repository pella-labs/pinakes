-- Phase 11.1: Add numeric confidence_score with time decay support (D50)
-- The TEXT confidence column is PRESERVED for backward compatibility.

ALTER TABLE `pinakes_nodes` ADD `confidence_score` real NOT NULL DEFAULT 0.7;--> statement-breakpoint

-- Backfill from existing TEXT confidence column
UPDATE `pinakes_nodes` SET `confidence_score` = CASE `confidence`
  WHEN 'extracted' THEN 0.7
  WHEN 'inferred' THEN 0.5
  WHEN 'ambiguous' THEN 0.3
  ELSE 0.7
END;
