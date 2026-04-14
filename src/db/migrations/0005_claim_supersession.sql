-- Phase 11.2: Add claim supersession tracking columns (D51)

ALTER TABLE `pinakes_claims` ADD `version` integer NOT NULL DEFAULT 1;--> statement-breakpoint
ALTER TABLE `pinakes_claims` ADD `superseded_by` integer REFERENCES `pinakes_claims`(`id`) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `pinakes_claims` ADD `superseded_at` integer;--> statement-breakpoint
CREATE INDEX `idx_claims_superseded` ON `pinakes_claims`(`superseded_at`) WHERE `superseded_at` IS NOT NULL;
