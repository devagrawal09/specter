CREATE TABLE `specter_event_commits` (
	`commit_version` integer PRIMARY KEY NOT NULL,
	`idempotency_key` text UNIQUE,
	`fingerprint` text,
	`first_event_order` integer NOT NULL,
	`last_event_order` integer NOT NULL,
	`committed_at` text NOT NULL
);
