CREATE TABLE `folders` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`parent_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `folders`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `folders_parent_id_idx` ON `folders` (`parent_id`);
--> statement-breakpoint
CREATE INDEX `folders_name_idx` ON `folders` (`name`);
--> statement-breakpoint
ALTER TABLE `outputs` ADD `folder_id` text REFERENCES folders(id) ON DELETE set null;
--> statement-breakpoint
CREATE INDEX `outputs_folder_id_idx` ON `outputs` (`folder_id`);
