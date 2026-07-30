ALTER TABLE `jobs` ADD `kind` text DEFAULT 'generation' NOT NULL;
--> statement-breakpoint
ALTER TABLE `jobs` ADD `parent_job_id` text;
--> statement-breakpoint
ALTER TABLE `jobs` ADD `source_output_id` text;
--> statement-breakpoint
CREATE INDEX `jobs_parent_job_id_idx` ON `jobs` (`parent_job_id`);
