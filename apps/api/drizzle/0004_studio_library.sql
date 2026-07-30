CREATE TABLE `character_profiles` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `description` text DEFAULT '' NOT NULL,
  `prompts_json` text NOT NULL,
  `instant_lora_json` text NOT NULL,
  `excluded_tags_json` text DEFAULT '[]' NOT NULL,
  `cache_json` text DEFAULT '{"state":"empty","cacheKey":null,"referenceFingerprint":null,"loraName":null,"trainedAt":null,"autoTags":[]}' NOT NULL,
  `representative_output_id` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`representative_output_id`) REFERENCES `outputs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `character_profiles_name_idx` ON `character_profiles` (`name`);
--> statement-breakpoint
CREATE INDEX `character_profiles_updated_at_idx` ON `character_profiles` (`updated_at`);
--> statement-breakpoint
CREATE TABLE `character_profile_assets` (
  `profile_id` text NOT NULL,
  `asset_id` text NOT NULL,
  `ordinal` integer NOT NULL,
  PRIMARY KEY(`profile_id`, `asset_id`),
  FOREIGN KEY (`profile_id`) REFERENCES `character_profiles`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `character_profile_assets_ordinal_unique` ON `character_profile_assets` (`profile_id`,`ordinal`);
--> statement-breakpoint
CREATE INDEX `character_profile_assets_asset_idx` ON `character_profile_assets` (`asset_id`);
--> statement-breakpoint
CREATE TABLE `model_packs` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `description` text DEFAULT '' NOT NULL,
  `model_json` text NOT NULL,
  `loras_json` text DEFAULT '[]' NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `model_packs_name_idx` ON `model_packs` (`name`);
--> statement-breakpoint
CREATE INDEX `model_packs_updated_at_idx` ON `model_packs` (`updated_at`);
--> statement-breakpoint
CREATE TABLE `generation_batches` (
  `id` text PRIMARY KEY NOT NULL,
  `axes_json` text DEFAULT '[]' NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `generation_batches_created_at_idx` ON `generation_batches` (`created_at`);
--> statement-breakpoint
CREATE TABLE `generation_batch_jobs` (
  `batch_id` text NOT NULL,
  `job_id` text NOT NULL,
  `label` text NOT NULL,
  `ordinal` integer NOT NULL,
  PRIMARY KEY(`batch_id`, `job_id`),
  FOREIGN KEY (`batch_id`) REFERENCES `generation_batches`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `generation_batch_jobs_job_unique` ON `generation_batch_jobs` (`job_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `generation_batch_jobs_ordinal_unique` ON `generation_batch_jobs` (`batch_id`,`ordinal`);
