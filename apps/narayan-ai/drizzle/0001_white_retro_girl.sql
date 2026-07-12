CREATE TABLE `narayan_assistant_reply_reaction_messages` (
	`message_id` text PRIMARY KEY NOT NULL,
	`phone_number` text NOT NULL,
	`role` text NOT NULL,
	`body` text NOT NULL,
	`created_at` text NOT NULL,
	`sort_order` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `narayan_assistant_reply_reaction_inbound` ADD `received_at` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `narayan_assistant_reply_reaction_inbound` ADD `sort_order` integer DEFAULT 0 NOT NULL;