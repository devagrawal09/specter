CREATE TABLE IF NOT EXISTS `create_todo_cheer_sql_milestone_states` (
	`milestone` integer PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `create_todo_cheer_sql_todo_states` (
	`todo_id` text PRIMARY KEY NOT NULL,
	`completed` integer DEFAULT false NOT NULL,
	`removed` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `todo_cheer_sql_milestone_states` (
	`milestone` integer PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `todo_completion_cheer_sql_todo_states` (
	`todo_id` text PRIMARY KEY NOT NULL,
	`completed` integer DEFAULT false NOT NULL,
	`removed` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `todo_completion_sql_states` (
	`todo_id` text PRIMARY KEY NOT NULL,
	`completed` integer DEFAULT false NOT NULL,
	`removed` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `todo_removal_sql_states` (
	`todo_id` text PRIMARY KEY NOT NULL,
	`removed` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `todo_sql_cheers` (
	`milestone` integer PRIMARY KEY NOT NULL,
	`message` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `todo_sql_list_items` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`completed` integer DEFAULT false NOT NULL,
	`removed` integer DEFAULT false
);
