CREATE TABLE `access_attempts` (
	`ip_hash` text PRIMARY KEY NOT NULL,
	`window_started_at` integer NOT NULL,
	`attempts` integer NOT NULL
);
