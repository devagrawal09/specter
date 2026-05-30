CREATE TABLE `approval_notification_sql_states` (
	`booking_id` text PRIMARY KEY NOT NULL,
	`approved` integer DEFAULT false NOT NULL,
	`notified` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `approve_booking_sql_bookings` (
	`booking_id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`requester_email` text NOT NULL,
	`requester_name` text NOT NULL,
	`purpose` text NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	`status` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `booking_activity_rows` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`booking_id` text,
	`room_id` text,
	`kind` text NOT NULL,
	`message` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `cancel_booking_sql_bookings` (
	`booking_id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`requester_email` text NOT NULL,
	`requester_name` text NOT NULL,
	`purpose` text NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	`status` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `check_in_booking_sql_bookings` (
	`booking_id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`requester_email` text NOT NULL,
	`requester_name` text NOT NULL,
	`purpose` text NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	`status` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `create_room_sql_rooms` (
	`room_id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`capacity` integer NOT NULL,
	`location` text NOT NULL,
	`retired` integer DEFAULT false NOT NULL
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
CREATE TABLE `pending_approval_rows` (
	`booking_id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`requester_email` text NOT NULL,
	`requester_name` text NOT NULL,
	`purpose` text NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	`status` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `record_approval_notification_sql_bookings` (
	`booking_id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`requester_email` text NOT NULL,
	`requester_name` text NOT NULL,
	`purpose` text NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	`status` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `reject_booking_sql_bookings` (
	`booking_id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`requester_email` text NOT NULL,
	`requester_name` text NOT NULL,
	`purpose` text NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	`status` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `release_room_sql_bookings` (
	`booking_id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`requester_email` text NOT NULL,
	`requester_name` text NOT NULL,
	`purpose` text NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	`status` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `request_booking_sql_bookings` (
	`booking_id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`requester_email` text NOT NULL,
	`requester_name` text NOT NULL,
	`purpose` text NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	`status` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `request_booking_sql_rooms` (
	`room_id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`capacity` integer NOT NULL,
	`location` text NOT NULL,
	`retired` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `reschedule_booking_sql_bookings` (
	`booking_id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`requester_email` text NOT NULL,
	`requester_name` text NOT NULL,
	`purpose` text NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	`status` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `reschedule_booking_sql_rooms` (
	`room_id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`capacity` integer NOT NULL,
	`location` text NOT NULL,
	`retired` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `retire_room_sql_bookings` (
	`booking_id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`requester_email` text NOT NULL,
	`requester_name` text NOT NULL,
	`purpose` text NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	`status` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `retire_room_sql_rooms` (
	`room_id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`capacity` integer NOT NULL,
	`location` text NOT NULL,
	`retired` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `room_schedule_bookings` (
	`booking_id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`requester_email` text NOT NULL,
	`requester_name` text NOT NULL,
	`purpose` text NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	`status` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `room_schedule_rooms` (
	`room_id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`capacity` integer NOT NULL,
	`location` text NOT NULL,
	`retired` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `slice_cursors` (
	`slice_name` text PRIMARY KEY NOT NULL,
	`last_applied_order` integer NOT NULL
);
