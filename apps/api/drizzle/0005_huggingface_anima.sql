CREATE TABLE `__new_model_downloads` (
  `id` text PRIMARY KEY NOT NULL,
  `operation_id` text NOT NULL,
  `state` text NOT NULL,
  `provider` text DEFAULT 'civitai' NOT NULL,
  `provider_download_id` text,
  `provider_model_id` text NOT NULL,
  `provider_version_id` text NOT NULL,
  `provider_file_id` text,
  `model_id` integer,
  `model_version_id` integer,
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
INSERT INTO `__new_model_downloads` (
  `id`,
  `operation_id`,
  `state`,
  `provider`,
  `provider_download_id`,
  `provider_model_id`,
  `provider_version_id`,
  `provider_file_id`,
  `model_id`,
  `model_version_id`,
  `file_id`,
  `model_name`,
  `version_name`,
  `filename`,
  `destination_root_id`,
  `relative_dir`,
  `expected_sha256`,
  `actual_sha256`,
  `bytes_completed`,
  `bytes_total`,
  `bytes_per_second`,
  `trigger_words_json`,
  `metadata_json`,
  `storage_path`,
  `error`,
  `created_at`,
  `updated_at`,
  `completed_at`
)
SELECT
  `id`,
  `operation_id`,
  `state`,
  `provider`,
  `provider_download_id`,
  CAST(`model_id` AS text),
  CAST(`model_version_id` AS text),
  CASE
    WHEN `file_id` IS NULL THEN NULL
    ELSE CAST(`file_id` AS text)
  END,
  `model_id`,
  `model_version_id`,
  `file_id`,
  `model_name`,
  `version_name`,
  `filename`,
  `destination_root_id`,
  `relative_dir`,
  `expected_sha256`,
  `actual_sha256`,
  `bytes_completed`,
  `bytes_total`,
  `bytes_per_second`,
  `trigger_words_json`,
  `metadata_json`,
  `storage_path`,
  `error`,
  `created_at`,
  `updated_at`,
  `completed_at`
FROM `model_downloads`;
--> statement-breakpoint
DROP TABLE `model_downloads`;
--> statement-breakpoint
ALTER TABLE `__new_model_downloads` RENAME TO `model_downloads`;
--> statement-breakpoint
CREATE UNIQUE INDEX `model_downloads_operation_id_unique`
ON `model_downloads` (`operation_id`);
--> statement-breakpoint
CREATE INDEX `model_downloads_state_idx`
ON `model_downloads` (`state`);
--> statement-breakpoint
CREATE INDEX `model_downloads_created_at_idx`
ON `model_downloads` (`created_at`);
--> statement-breakpoint
CREATE INDEX `model_downloads_version_idx`
ON `model_downloads` (`model_id`, `model_version_id`);
--> statement-breakpoint
CREATE INDEX `model_downloads_provider_file_idx`
ON `model_downloads` (
  `provider`,
  `provider_model_id`,
  `provider_version_id`,
  `provider_file_id`
);
