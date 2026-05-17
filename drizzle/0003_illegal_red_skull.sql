CREATE TABLE `events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`type` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `todo_cheer_milestone_states` (
	`milestone` integer PRIMARY KEY NOT NULL,
	`last_applied_event_id` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `todo_cheers` (
	`milestone` integer PRIMARY KEY NOT NULL,
	`message` text NOT NULL,
	`last_applied_event_id` integer NOT NULL
);
--> statement-breakpoint
DROP TABLE `todo_events`;--> statement-breakpoint
ALTER TABLE `todo_completion_states` ADD `removed` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `todo_completion_states` DROP COLUMN `removed_at`;--> statement-breakpoint
ALTER TABLE `todo_list_items` ADD `removed` integer DEFAULT false;--> statement-breakpoint
ALTER TABLE `todo_list_items` DROP COLUMN `created_at`;--> statement-breakpoint
ALTER TABLE `todo_list_items` DROP COLUMN `updated_at`;--> statement-breakpoint
ALTER TABLE `todo_list_items` DROP COLUMN `removed_at`;--> statement-breakpoint
ALTER TABLE `todo_removal_states` ADD `removed` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `todo_removal_states` DROP COLUMN `removed_at`;