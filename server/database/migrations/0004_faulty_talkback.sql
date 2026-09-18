CREATE TABLE `attachment_links` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`attachment_id` text NOT NULL,
	`message_id` integer NOT NULL,
	FOREIGN KEY (`attachment_id`) REFERENCES `attachments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `attachment_links_message_uq` ON `attachment_links` (`attachment_id`,`message_id`);--> statement-breakpoint
CREATE INDEX `attachment_links_message_idx` ON `attachment_links` (`message_id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_attachments` (
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
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_attachments`("id", "user_id", "plan_id", "message_id", "filename", "media_type", "size", "width", "height", "content", "created_at") SELECT "id", "user_id", "plan_id", "message_id", "filename", "media_type", "size", "width", "height", "content", "created_at" FROM `attachments`;--> statement-breakpoint
DROP TABLE `attachments`;--> statement-breakpoint
ALTER TABLE `__new_attachments` RENAME TO `attachments`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `attachments_user_plan_idx` ON `attachments` (`user_id`,`plan_id`);--> statement-breakpoint
CREATE INDEX `attachments_orphan_idx` ON `attachments` (`message_id`,`created_at`);