ALTER TABLE `job_inpaints` ADD `input_source_asset_id` text REFERENCES assets(id);--> statement-breakpoint
ALTER TABLE `job_inpaints` ADD `root_source_asset_id` text REFERENCES assets(id);--> statement-breakpoint
UPDATE `job_inpaints` SET `input_source_asset_id` = `source_asset_id`, `root_source_asset_id` = `source_asset_id` WHERE `source_asset_id` IS NOT NULL;--> statement-breakpoint
DELETE FROM `job_inpaints` WHERE `input_source_asset_id` IS NULL OR `root_source_asset_id` IS NULL;--> statement-breakpoint
CREATE INDEX `job_inpaints_input_source_asset_id_idx` ON `job_inpaints` (`input_source_asset_id`);--> statement-breakpoint
CREATE INDEX `job_inpaints_root_source_asset_id_idx` ON `job_inpaints` (`root_source_asset_id`);
