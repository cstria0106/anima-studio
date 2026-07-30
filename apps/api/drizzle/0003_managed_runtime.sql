CREATE TABLE `system_operations` (
  `id` text PRIMARY KEY NOT NULL,
  `kind` text NOT NULL,
  `status` text NOT NULL,
  `phase` text NOT NULL,
  `message` text DEFAULT '' NOT NULL,
  `progress` integer,
  `metadata_json` text DEFAULT '{}' NOT NULL,
  `error` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `started_at` text,
  `completed_at` text
);
--> statement-breakpoint
CREATE INDEX `system_operations_status_idx` ON `system_operations` (`status`);
--> statement-breakpoint
CREATE INDEX `system_operations_kind_created_idx` ON `system_operations` (`kind`,`created_at`);
--> statement-breakpoint
CREATE TABLE `system_operation_events` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `operation_id` text NOT NULL,
  `phase` text NOT NULL,
  `message` text NOT NULL,
  `progress` integer,
  `current` integer,
  `total` integer,
  `bytes_completed` integer,
  `bytes_total` integer,
  `bytes_per_second` integer,
  `payload_json` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`operation_id`) REFERENCES `system_operations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `system_operation_events_operation_id_idx` ON `system_operation_events` (`operation_id`,`id`);
--> statement-breakpoint
CREATE TABLE `runtime_sessions` (
  `id` text PRIMARY KEY NOT NULL,
  `bundle_id` text NOT NULL,
  `pid` integer NOT NULL,
  `executable_path` text NOT NULL,
  `command_json` text NOT NULL,
  `port` integer NOT NULL,
  `log_path` text NOT NULL,
  `status` text NOT NULL,
  `started_at` text NOT NULL,
  `stopped_at` text,
  `exit_code` integer
);
--> statement-breakpoint
CREATE INDEX `runtime_sessions_status_idx` ON `runtime_sessions` (`status`);
--> statement-breakpoint
CREATE INDEX `runtime_sessions_started_at_idx` ON `runtime_sessions` (`started_at`);
--> statement-breakpoint
CREATE TABLE `model_downloads` (
  `id` text PRIMARY KEY NOT NULL,
  `operation_id` text NOT NULL,
  `state` text NOT NULL,
  `provider` text DEFAULT 'civitai' NOT NULL,
  `provider_download_id` text,
  `model_id` integer NOT NULL,
  `model_version_id` integer NOT NULL,
  `file_id` integer,
  `model_name` text NOT NULL,
  `version_name` text NOT NULL,
  `filename` text NOT NULL,
  `destination_root_id` text NOT NULL,
  `relative_dir` text DEFAULT '' NOT NULL,
  `expected_sha256` text,
  `actual_sha256` text,
  `bytes_completed` integer DEFAULT 0 NOT NULL,
  `bytes_total` integer,
  `bytes_per_second` integer,
  `trigger_words_json` text DEFAULT '[]' NOT NULL,
  `metadata_json` text DEFAULT '{}' NOT NULL,
  `storage_path` text,
  `error` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `completed_at` text,
  FOREIGN KEY (`operation_id`) REFERENCES `system_operations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `model_downloads_operation_id_unique` ON `model_downloads` (`operation_id`);
--> statement-breakpoint
CREATE INDEX `model_downloads_state_idx` ON `model_downloads` (`state`);
--> statement-breakpoint
CREATE INDEX `model_downloads_created_at_idx` ON `model_downloads` (`created_at`);
--> statement-breakpoint
CREATE INDEX `model_downloads_version_idx` ON `model_downloads` (`model_id`,`model_version_id`);
