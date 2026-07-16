CREATE TABLE `specter_event_commits` (
	`idempotency_key` text PRIMARY KEY NOT NULL,
	`fingerprint` text,
	`first_event_order` integer NOT NULL,
	`last_event_order` integer NOT NULL,
	`committed_at` text NOT NULL
);
