ALTER TABLE `markets` ADD `event_ticker` text;
--> statement-breakpoint
ALTER TABLE `markets` ADD `series_ticker` text;
--> statement-breakpoint
ALTER TABLE `markets` ADD `open_time` text;
--> statement-breakpoint
ALTER TABLE `markets` ADD `start_time` text;
--> statement-breakpoint
ALTER TABLE `markets` ADD `end_time` text;
--> statement-breakpoint
ALTER TABLE `markets` ADD `group_title` text;
--> statement-breakpoint
ALTER TABLE `markets` ADD `market_shape` text DEFAULT 'unknown' NOT NULL;
--> statement-breakpoint
ALTER TABLE `markets` ADD `is_binary_eligible` integer DEFAULT false NOT NULL;
