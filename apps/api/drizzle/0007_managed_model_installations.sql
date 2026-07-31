CREATE TABLE `managed_model_installations` (
  `id` text PRIMARY KEY NOT NULL,
  `provider` text NOT NULL,
  `provider_model_id` text NOT NULL,
  `provider_version_id` text NOT NULL,
  `provider_file_id` text,
  `model_name` text NOT NULL,
  `version_name` text NOT NULL,
  `filename` text NOT NULL,
  `destination_root_id` text NOT NULL,
  `relative_dir` text DEFAULT '' NOT NULL,
  `sha256` text NOT NULL,
  `storage_path` text NOT NULL,
  `installed_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `managed_model_installations_provider_file_unique`
ON `managed_model_installations` (
  `provider`,
  `provider_model_id`,
  `provider_version_id`,
  `provider_file_id`
);
--> statement-breakpoint
CREATE UNIQUE INDEX `managed_model_installations_storage_path_unique`
ON `managed_model_installations` (`storage_path`);
--> statement-breakpoint
CREATE INDEX `managed_model_installations_installed_at_idx`
ON `managed_model_installations` (`installed_at`);
--> statement-breakpoint
INSERT INTO `managed_model_installations` (
  `id`,
  `provider`,
  `provider_model_id`,
  `provider_version_id`,
  `provider_file_id`,
  `model_name`,
  `version_name`,
  `filename`,
  `destination_root_id`,
  `relative_dir`,
  `sha256`,
  `storage_path`,
  `installed_at`,
  `updated_at`
)
SELECT
  `id`,
  `provider`,
  `provider_model_id`,
  `provider_version_id`,
  `provider_file_id`,
  `model_name`,
  `version_name`,
  `filename`,
  `destination_root_id`,
  `relative_dir`,
  lower(trim(`actual_sha256`)),
  `storage_path`,
  COALESCE(`completed_at`, `updated_at`, `created_at`),
  COALESCE(`completed_at`, `updated_at`, `created_at`)
FROM `model_downloads`
WHERE
  `state` = 'completed'
  AND `provider_file_id` IS NOT NULL
  AND trim(`provider_file_id`) <> ''
  AND `storage_path` IS NOT NULL
  AND trim(`storage_path`) <> ''
  AND `actual_sha256` IS NOT NULL
  AND length(trim(`actual_sha256`)) = 64
  AND trim(`actual_sha256`) NOT GLOB '*[^0-9A-Fa-f]*'
  AND (
    `expected_sha256` IS NULL
    OR lower(trim(`expected_sha256`)) = lower(trim(`actual_sha256`))
  )
ON CONFLICT DO NOTHING;
--> statement-breakpoint
DELETE FROM `system_operations`
WHERE `kind` = 'model_download';
