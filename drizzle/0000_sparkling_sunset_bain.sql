CREATE TABLE `events` (
	`order` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id` text NOT NULL,
	`type` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `events_id_unique` ON `events` (`id`);
--> statement-breakpoint
CREATE INDEX `events_order_idx` ON `events` (`order`);
--> statement-breakpoint
CREATE TABLE `slice_cursors` (
	`slice_name` text NOT NULL,
	`last_applied_order` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `slice_json_states` (
	`slice_name` text NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL
);
