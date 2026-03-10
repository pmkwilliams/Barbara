CREATE TABLE `ingestion_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`platform` text NOT NULL,
	`started_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`completed_at` text,
	`markets_found` integer,
	`markets_created` integer,
	`markets_updated` integer,
	`status` text DEFAULT 'running' NOT NULL,
	`error` text
);
--> statement-breakpoint
CREATE TABLE `markets` (
	`id` text PRIMARY KEY NOT NULL,
	`platform` text NOT NULL,
	`platform_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`outcome_labels` text NOT NULL,
	`resolution_source` text,
	`resolution_rules` text,
	`close_time` text,
	`category` text,
	`status` text DEFAULT 'active' NOT NULL,
	`volume` real,
	`resolution_hash` text,
	`raw_data` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `markets_platform_platform_id_unique` ON `markets` (`platform`,`platform_id`);
