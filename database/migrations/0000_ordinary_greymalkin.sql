CREATE TABLE `game_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`warning_id` integer NOT NULL,
	`game_code` text NOT NULL,
	`turn` integer NOT NULL,
	`data` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`warning_id`) REFERENCES `warnings`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `identity_ips` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`identity` text NOT NULL,
	`ip` text NOT NULL,
	`last_seen_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `identity_ips_pair` ON `identity_ips` (`identity`,`ip`);--> statement-breakpoint
CREATE INDEX `identity_ips_identity` ON `identity_ips` (`identity`);--> statement-breakpoint
CREATE TABLE `ip_bans` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ip` text NOT NULL,
	`identity` text NOT NULL,
	`warning_id` integer,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`warning_id`) REFERENCES `warnings`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ip_bans_ip` ON `ip_bans` (`ip`);--> statement-breakpoint
CREATE TABLE `referrals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`referrer_id` text NOT NULL,
	`referred_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`referrer_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`referred_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `referrals_referred_id_unique` ON `referrals` (`referred_id`);--> statement-breakpoint
CREATE TABLE `reports` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`warning_id` integer NOT NULL,
	`reporter_identity` text NOT NULL,
	`reason` text NOT NULL,
	`details` text DEFAULT '' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`warning_id`) REFERENCES `warnings`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reports_once_per_reporter` ON `reports` (`warning_id`,`reporter_identity`);--> statement-breakpoint
CREATE TABLE `unlocks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`item_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `unlocks_user_item` ON `unlocks` (`user_id`,`item_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`credits` integer DEFAULT 0 NOT NULL,
	`referral_code` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_referral_code_unique` ON `users` (`referral_code`);--> statement-breakpoint
CREATE TABLE `warnings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`offender_identity` text NOT NULL,
	`game_code` text NOT NULL,
	`turn` integer NOT NULL,
	`reason` text NOT NULL,
	`level` integer NOT NULL,
	`acknowledged_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `warnings_offender` ON `warnings` (`offender_identity`);--> statement-breakpoint
CREATE UNIQUE INDEX `warnings_offense` ON `warnings` (`offender_identity`,`game_code`,`turn`);