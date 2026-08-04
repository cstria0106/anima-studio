PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_job_inpaints` (
	`job_id` text PRIMARY KEY NOT NULL,
	`input_source_asset_id` text NOT NULL,
	`root_source_asset_id` text NOT NULL,
	`mask_asset_id` text NOT NULL,
	`grow_mask_by` integer DEFAULT 6 NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`input_source_asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`root_source_asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`mask_asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
INSERT INTO `__new_job_inpaints`("job_id", "input_source_asset_id", "root_source_asset_id", "mask_asset_id", "grow_mask_by") SELECT "job_id", "input_source_asset_id", "root_source_asset_id", "mask_asset_id", "grow_mask_by" FROM `job_inpaints`;--> statement-breakpoint
DROP TABLE `job_inpaints`;--> statement-breakpoint
ALTER TABLE `__new_job_inpaints` RENAME TO `job_inpaints`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `job_inpaints_input_source_asset_id_idx` ON `job_inpaints` (`input_source_asset_id`);--> statement-breakpoint
CREATE INDEX `job_inpaints_root_source_asset_id_idx` ON `job_inpaints` (`root_source_asset_id`);--> statement-breakpoint
CREATE INDEX `job_inpaints_mask_asset_id_idx` ON `job_inpaints` (`mask_asset_id`);