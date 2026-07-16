CREATE TABLE `narayan_twilio_delivery_attempts` (
	`delivery_id` text PRIMARY KEY NOT NULL,
	`outbound_message_id` text NOT NULL,
	`to_phone` text NOT NULL,
	`from_phone` text NOT NULL,
	`body` text NOT NULL,
	`status` text NOT NULL,
	`attempt_number` integer NOT NULL,
	`started_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`provider_message_sid` text,
	`provider_status` text,
	`last_error` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `narayan_twilio_delivery_attempts_outbound_message_id_unique` ON `narayan_twilio_delivery_attempts` (`outbound_message_id`);--> statement-breakpoint
ALTER TABLE `narayan_conversations` ADD `last_message_id` text NOT NULL DEFAULT '';
