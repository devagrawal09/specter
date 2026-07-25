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
  `slice_name` text PRIMARY KEY NOT NULL,
  `last_applied_order` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `gmail_credentials` (
  `account` text PRIMARY KEY NOT NULL,
  `access_token` text NOT NULL,
  `refresh_token` text,
  `expires_at` integer NOT NULL,
  `email` text
);
--> statement-breakpoint
CREATE TABLE `gmail_sync_state` (
  `account` text PRIMARY KEY NOT NULL,
  `history_id` text,
  `last_synced_at` text
);
--> statement-breakpoint
CREATE TABLE `gmail_oauth_states` (
  `state` text PRIMARY KEY NOT NULL,
  `expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `gmail_action_attempts` (
  `delivery_id` text PRIMARY KEY NOT NULL,
  `action_id` text NOT NULL,
  `thread_id` text NOT NULL,
  `action` text NOT NULL,
  `status` text NOT NULL,
  `error` text,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `mail_analysis_request_states` (
  `thread_id` text PRIMARY KEY NOT NULL,
  `last_analysis_id` text,
  `last_provider` text,
  `status` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `mail_action_request_states` (
  `action_id` text PRIMARY KEY NOT NULL,
  `thread_id` text NOT NULL,
  `status` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `mail_action_request_threads` (
  `thread_id` text PRIMARY KEY NOT NULL,
  `sender` text NOT NULL,
  `subject` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `mail_action_request_rules` (
  `rule_id` text PRIMARY KEY NOT NULL,
  `sender_contains` text NOT NULL,
  `subject_contains` text NOT NULL,
  `action` text NOT NULL,
  `enabled` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `mail_analysis_reaction_states` (
  `analysis_id` text PRIMARY KEY NOT NULL,
  `thread_id` text NOT NULL,
  `provider` text NOT NULL,
  `status` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `mail_analysis_reaction_threads` (
  `thread_id` text PRIMARY KEY NOT NULL,
  `sender` text NOT NULL,
  `subject` text NOT NULL,
  `body_text` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `mailbox_action_reaction_states` (
  `action_id` text PRIMARY KEY NOT NULL,
  `thread_id` text NOT NULL,
  `action` text NOT NULL,
  `status` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `mail_inbox_projection` (
  `thread_id` text PRIMARY KEY NOT NULL,
  `message_id` text NOT NULL,
  `history_id` text NOT NULL,
  `sender` text NOT NULL,
  `subject` text NOT NULL,
  `snippet` text NOT NULL,
  `body_text` text NOT NULL,
  `received_at` text NOT NULL,
  `unread` integer NOT NULL,
  `labels_json` text NOT NULL,
  `analysis_id` text,
  `summary` text,
  `priority` text,
  `suggested_action` text,
  `analysis_provider` text
);
--> statement-breakpoint
CREATE TABLE `mail_rule_projection` (
  `rule_id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `sender_contains` text NOT NULL,
  `subject_contains` text NOT NULL,
  `action` text NOT NULL,
  `enabled` integer NOT NULL,
  `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `mail_activity_projection` (
  `activity_id` text PRIMARY KEY NOT NULL,
  `thread_id` text NOT NULL,
  `kind` text NOT NULL,
  `status` text NOT NULL,
  `detail` text NOT NULL,
  `occurred_at` text NOT NULL
);
