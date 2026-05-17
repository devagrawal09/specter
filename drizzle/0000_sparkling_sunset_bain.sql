CREATE TABLE `create_todo_cheer_milestone_states` (
	`milestone` integer PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE TABLE `create_todo_cheer_todo_states` (
	`todo_id` text PRIMARY KEY NOT NULL,
	`completed` integer DEFAULT false NOT NULL,
	`removed` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `todo_cheer_milestone_states` (
	`milestone` integer PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE TABLE `todo_cheers` (
	`milestone` integer PRIMARY KEY NOT NULL,
	`message` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `todo_completion_cheer_todo_states` (
	`todo_id` text PRIMARY KEY NOT NULL,
	`completed` integer DEFAULT false NOT NULL,
	`removed` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `todo_completion_states` (
	`todo_id` text PRIMARY KEY NOT NULL,
	`completed` integer DEFAULT false NOT NULL,
	`removed` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `todo_list_items` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`completed` integer DEFAULT false NOT NULL,
	`removed` integer DEFAULT false
);
--> statement-breakpoint
CREATE TABLE `todo_removal_states` (
	`todo_id` text PRIMARY KEY NOT NULL,
	`removed` integer DEFAULT false NOT NULL
);
