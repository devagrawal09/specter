CREATE TABLE `create_todo_cheer_sql_milestone_states` (
	`milestone` integer PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE TABLE `create_todo_cheer_sql_todo_states` (
	`todo_id` text PRIMARY KEY NOT NULL,
	`completed` integer DEFAULT false NOT NULL,
	`removed` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `events` (
	`order` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id` text NOT NULL,
	`type` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `events_id_unique` ON `events` (`id`);--> statement-breakpoint
CREATE INDEX `events_order_idx` ON `events` (`order`);--> statement-breakpoint
CREATE TABLE `slice_cursors` (
	`slice_name` text PRIMARY KEY NOT NULL,
	`last_applied_order` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `todo_cheer_sql_milestone_states` (
	`milestone` integer PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE TABLE `todo_completion_cheer_sql_todo_states` (
	`todo_id` text PRIMARY KEY NOT NULL,
	`completed` integer DEFAULT false NOT NULL,
	`removed` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `todo_completion_sql_states` (
	`todo_id` text PRIMARY KEY NOT NULL,
	`completed` integer DEFAULT false NOT NULL,
	`removed` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `todo_removal_sql_states` (
	`todo_id` text PRIMARY KEY NOT NULL,
	`removed` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `todo_sql_cheers` (
	`milestone` integer PRIMARY KEY NOT NULL,
	`message` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `todo_sql_list_items` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`completed` integer DEFAULT false NOT NULL,
	`removed` integer DEFAULT false
);
