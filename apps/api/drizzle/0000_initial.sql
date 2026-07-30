PRAGMA foreign_keys = ON;
--> statement-breakpoint
CREATE TABLE `settings` (
  `key` text PRIMARY KEY NOT NULL,
  `value_json` text NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `assets` (
  `id` text PRIMARY KEY NOT NULL,
  `sha256` text NOT NULL,
  `original_name` text NOT NULL,
  `mime_type` text NOT NULL,
  `byte_size` integer NOT NULL,
  `width` integer,
  `height` integer,
  `storage_path` text NOT NULL,
  `comfy_filename` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assets_sha256_unique` ON `assets` (`sha256`);
--> statement-breakpoint
CREATE INDEX `assets_created_at_idx` ON `assets` (`created_at`);
--> statement-breakpoint
CREATE TABLE `jobs` (
  `id` text PRIMARY KEY NOT NULL,
  `status` text NOT NULL,
  `phase` text NOT NULL,
  `comfy_prompt_id` text,
  `comfy_client_id` text NOT NULL,
  `queue_number` integer,
  `config_json` text NOT NULL,
  `workflow_json` text,
  `node_phases_json` text,
  `node_labels_json` text,
  `output_kinds_json` text,
  `auto_tags_node_id` text,
  `actual_seed` integer NOT NULL,
  `auto_tags` text DEFAULT '' NOT NULL,
  `error` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `started_at` text,
  `completed_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_comfy_prompt_id_unique` ON `jobs` (`comfy_prompt_id`);
--> statement-breakpoint
CREATE INDEX `jobs_status_idx` ON `jobs` (`status`);
--> statement-breakpoint
CREATE INDEX `jobs_created_at_idx` ON `jobs` (`created_at`);
--> statement-breakpoint
CREATE TABLE `job_assets` (
  `job_id` text NOT NULL,
  `asset_id` text NOT NULL,
  `ordinal` integer NOT NULL,
  PRIMARY KEY (`job_id`, `asset_id`),
  FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `job_assets_ordinal_unique` ON `job_assets` (`job_id`,`ordinal`);
--> statement-breakpoint
CREATE TABLE `job_events` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `job_id` text NOT NULL,
  `phase` text NOT NULL,
  `message` text NOT NULL,
  `progress` integer,
  `current` integer,
  `total` integer,
  `payload_json` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `job_events_job_id_id_idx` ON `job_events` (`job_id`,`id`);
--> statement-breakpoint
CREATE INDEX `job_events_created_at_idx` ON `job_events` (`created_at`);
--> statement-breakpoint
CREATE TABLE `outputs` (
  `id` text PRIMARY KEY NOT NULL,
  `job_id` text NOT NULL,
  `kind` text NOT NULL,
  `node_id` text NOT NULL,
  `filename` text NOT NULL,
  `mime_type` text NOT NULL,
  `byte_size` integer NOT NULL,
  `width` integer,
  `height` integer,
  `storage_path` text NOT NULL,
  `comfy_filename` text NOT NULL,
  `comfy_subfolder` text DEFAULT '' NOT NULL,
  `comfy_type` text DEFAULT 'output' NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `outputs_comfy_file_unique` ON `outputs` (`job_id`,`node_id`,`comfy_filename`,`comfy_subfolder`);
--> statement-breakpoint
CREATE INDEX `outputs_job_id_idx` ON `outputs` (`job_id`);
--> statement-breakpoint
CREATE TABLE `tags` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `tag` text NOT NULL,
  `category` text NOT NULL,
  `count` integer DEFAULT 0 NOT NULL,
  `description` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_tag_unique` ON `tags` (`tag`);
--> statement-breakpoint
CREATE INDEX `tags_count_idx` ON `tags` (`count`);
--> statement-breakpoint
CREATE VIRTUAL TABLE `tag_search` USING fts5(
  `tag`,
  `description`,
  content='tags',
  content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);
--> statement-breakpoint
CREATE TRIGGER `tags_after_insert` AFTER INSERT ON `tags` BEGIN
  INSERT INTO `tag_search`(rowid, tag, description)
  VALUES (new.id, new.tag, new.description);
END;
--> statement-breakpoint
CREATE TRIGGER `tags_after_delete` AFTER DELETE ON `tags` BEGIN
  INSERT INTO `tag_search`(`tag_search`, rowid, tag, description)
  VALUES ('delete', old.id, old.tag, old.description);
END;
--> statement-breakpoint
CREATE TRIGGER `tags_after_update` AFTER UPDATE ON `tags` BEGIN
  INSERT INTO `tag_search`(`tag_search`, rowid, tag, description)
  VALUES ('delete', old.id, old.tag, old.description);
  INSERT INTO `tag_search`(rowid, tag, description)
  VALUES (new.id, new.tag, new.description);
END;
