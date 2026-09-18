CREATE TABLE `attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`plan_id` integer NOT NULL,
	`message_id` integer,
	`filename` text NOT NULL,
	`media_type` text NOT NULL,
	`size` integer NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`content` blob NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `attachments_user_plan_idx` ON `attachments` (`user_id`,`plan_id`);--> statement-breakpoint
CREATE INDEX `attachments_orphan_idx` ON `attachments` (`message_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `model_settings` (
	`user_id` text PRIMARY KEY NOT NULL,
	`configuration_json` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `plan_resources` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`plan_id` integer NOT NULL,
	`entity_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`plan_revision` integer NOT NULL,
	`resource_json` text NOT NULL,
	`image_origin_url` text,
	`image_cache_key` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `plan_resources_plan_entity_uq` ON `plan_resources` (`plan_id`,`entity_id`);--> statement-breakpoint
CREATE INDEX `plan_resources_owner_idx` ON `plan_resources` (`user_id`,`plan_id`);--> statement-breakpoint
ALTER TABLE `messages` ADD `parts_json` text;--> statement-breakpoint
ALTER TABLE `chat_runs` ADD `configuration_json` text;