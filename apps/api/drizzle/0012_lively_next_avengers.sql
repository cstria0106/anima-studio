CREATE TABLE `job_inpaints` (
	`job_id` text PRIMARY KEY NOT NULL,
	`source_asset_id` text,
	`mask_asset_id` text NOT NULL,
	`grow_mask_by` integer DEFAULT 6 NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`mask_asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `job_inpaints_source_asset_id_idx` ON `job_inpaints` (`source_asset_id`);--> statement-breakpoint
CREATE INDEX `job_inpaints_mask_asset_id_idx` ON `job_inpaints` (`mask_asset_id`);
