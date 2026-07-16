ALTER TABLE `booking_activity_rows` ADD `event_id` text NOT NULL DEFAULT '';
--> statement-breakpoint
UPDATE `booking_activity_rows`
SET `event_id` = 'legacy-' || `id`
WHERE `event_id` = '';
--> statement-breakpoint
CREATE UNIQUE INDEX `booking_activity_rows_event_id_unique`
ON `booking_activity_rows` (`event_id`);
