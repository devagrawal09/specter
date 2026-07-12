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
CREATE TABLE `narayan_assistant_reply_reaction_inbound` (
	`inbound_message_id` text PRIMARY KEY NOT NULL,
	`from_phone` text NOT NULL,
	`body` text NOT NULL,
	`replied` text DEFAULT 'false' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `narayan_conversation_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`phone_number` text NOT NULL,
	`direction` text NOT NULL,
	`body` text NOT NULL,
	`status` text NOT NULL,
	`twilio_message_sid` text,
	`related_message_id` text,
	`created_at` text NOT NULL,
	`sort_order` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `narayan_conversations` (
	`phone_number` text PRIMARY KEY NOT NULL,
	`last_message_body` text NOT NULL,
	`last_message_direction` text NOT NULL,
	`last_message_status` text NOT NULL,
	`last_message_at` text NOT NULL,
	`message_count` integer NOT NULL,
	`sort_order` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `narayan_inbound_command_messages` (
	`twilio_message_sid` text PRIMARY KEY NOT NULL,
	`inbound_message_id` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `narayan_twilio_outbound_reaction_messages` (
	`outbound_message_id` text PRIMARY KEY NOT NULL,
	`to_phone` text NOT NULL,
	`body` text NOT NULL,
	`status` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `slice_cursors` (
	`slice_name` text PRIMARY KEY NOT NULL,
	`last_applied_order` integer NOT NULL
);
