CREATE TABLE `todo_completion_states` (
	`todo_id` text PRIMARY KEY NOT NULL,
	`completed` integer DEFAULT false NOT NULL,
	`removed_at` integer,
	`last_applied_event_id` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `todo_list_items` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`completed` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`removed_at` integer,
	`last_applied_event_id` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `todo_removal_states` (
	`todo_id` text PRIMARY KEY NOT NULL,
	`removed_at` integer,
	`last_applied_event_id` integer NOT NULL
);
--> statement-breakpoint
DELETE FROM `todo_events`;
--> statement-breakpoint
DROP TABLE `todos`;
