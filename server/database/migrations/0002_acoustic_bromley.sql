CREATE TABLE `chat_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`request_id` text NOT NULL,
	`request_hash` text NOT NULL,
	`plan_id` integer NOT NULL,
	`conversation_id` integer NOT NULL,
	`assistant_message_id` integer,
	`status` text NOT NULL,
	`steps` integer DEFAULT 0 NOT NULL,
	`error_code` text,
	`started_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chat_runs_user_request_uq` ON `chat_runs` (`user_id`,`request_id`);--> statement-breakpoint
CREATE INDEX `chat_runs_status_idx` ON `chat_runs` (`status`);--> statement-breakpoint
CREATE INDEX `chat_runs_user_started_idx` ON `chat_runs` (`user_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `chat_runs_started_idx` ON `chat_runs` (`started_at`);--> statement-breakpoint
CREATE INDEX `chat_runs_conversation_idx` ON `chat_runs` (`conversation_id`,`id`);--> statement-breakpoint
CREATE TABLE `usage_metrics` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`day` text NOT NULL,
	`user_id` text DEFAULT '' NOT NULL,
	`service` text NOT NULL,
	`requests` integer DEFAULT 0 NOT NULL,
	`errors` integer DEFAULT 0 NOT NULL,
	`cache_hits` integer DEFAULT 0 NOT NULL,
	`duration_ms` integer DEFAULT 0 NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`usage_samples` integer DEFAULT 0 NOT NULL,
	`steps` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `usage_metrics_day_user_service_uq` ON `usage_metrics` (`day`,`user_id`,`service`);--> statement-breakpoint
DROP INDEX `conversations_plan_idx`;--> statement-breakpoint
CREATE INDEX `conversations_user_updated_idx` ON `conversations` (`user_id`,`updated_at`,`id`);--> statement-breakpoint
CREATE INDEX `conversations_plan_idx` ON `conversations` (`plan_id`,`updated_at`,`id`);--> statement-breakpoint
DROP INDEX `messages_conversation_idx`;--> statement-breakpoint
CREATE INDEX `messages_conversation_idx` ON `messages` (`conversation_id`,`created_at`,`id`);--> statement-breakpoint
DROP INDEX `plans_user_updated_idx`;--> statement-breakpoint
ALTER TABLE `plans` ADD `revision` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE INDEX `plans_user_updated_idx` ON `plans` (`user_id`,`updated_at`,`id`);--> statement-breakpoint
CREATE INDEX `cache_expires_idx` ON `cache` (`expires_at`);--> statement-breakpoint
CREATE INDEX `plan_versions_turn_idx` ON `plan_versions` (`plan_id`,`message_id`,`source`,`version`);