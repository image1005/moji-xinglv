CREATE TABLE `plan_run_drafts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` integer NOT NULL,
	`plan_id` integer NOT NULL,
	`message_id` integer NOT NULL,
	`base_version_id` integer,
	`base_revision` integer NOT NULL,
	`revision` integer NOT NULL,
	`plan_json` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`result_version_id` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `chat_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `plan_run_drafts_run_uq` ON `plan_run_drafts` (`run_id`);--> statement-breakpoint
CREATE INDEX `plan_run_drafts_plan_idx` ON `plan_run_drafts` (`plan_id`,`id`);--> statement-breakpoint
ALTER TABLE `plan_versions` ADD `name` text;--> statement-breakpoint
ALTER TABLE `plan_versions` ADD `name_source` text;--> statement-breakpoint
ALTER TABLE `plan_versions` ADD `name_revision` integer DEFAULT 0 NOT NULL;