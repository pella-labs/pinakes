CREATE TABLE `pinakes_claims` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`scope` text NOT NULL,
	`source_uri` text NOT NULL,
	`chunk_id` text REFERENCES `pinakes_chunks`(`id`) ON DELETE SET NULL,
	`topic` text NOT NULL,
	`claim` text NOT NULL,
	`extracted_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_claims_topic` ON `pinakes_claims` (`scope`,`topic`);
--> statement-breakpoint
CREATE INDEX `idx_claims_source` ON `pinakes_claims` (`scope`,`source_uri`);
