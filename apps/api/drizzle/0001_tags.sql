ALTER TABLE `tags` ADD `aliases` text DEFAULT '' NOT NULL;
--> statement-breakpoint
DROP TRIGGER `tags_after_insert`;
--> statement-breakpoint
DROP TRIGGER `tags_after_delete`;
--> statement-breakpoint
DROP TRIGGER `tags_after_update`;
--> statement-breakpoint
DROP TABLE `tag_search`;
--> statement-breakpoint
CREATE VIRTUAL TABLE `tag_search` USING fts5(
  `tag`,
  `description`,
  `aliases`,
  content='tags',
  content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);
--> statement-breakpoint
CREATE TRIGGER `tags_after_insert` AFTER INSERT ON `tags` BEGIN
  INSERT INTO `tag_search`(rowid, tag, description, aliases)
  VALUES (new.id, new.tag, new.description, new.aliases);
END;
--> statement-breakpoint
CREATE TRIGGER `tags_after_delete` AFTER DELETE ON `tags` BEGIN
  INSERT INTO `tag_search`(`tag_search`, rowid, tag, description, aliases)
  VALUES ('delete', old.id, old.tag, old.description, old.aliases);
END;
--> statement-breakpoint
CREATE TRIGGER `tags_after_update` AFTER UPDATE ON `tags` BEGIN
  INSERT INTO `tag_search`(`tag_search`, rowid, tag, description, aliases)
  VALUES ('delete', old.id, old.tag, old.description, old.aliases);
  INSERT INTO `tag_search`(rowid, tag, description, aliases)
  VALUES (new.id, new.tag, new.description, new.aliases);
END;
--> statement-breakpoint
INSERT INTO `tag_search`(`tag_search`) VALUES ('rebuild');
--> statement-breakpoint
CREATE TABLE `tag_cooccurrences` (
  `tag_id` integer NOT NULL,
  `related_tag_id` integer NOT NULL,
  `count` integer NOT NULL,
  PRIMARY KEY(`tag_id`, `related_tag_id`),
  FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`related_tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `tag_cooccurrences_tag_count_idx`
  ON `tag_cooccurrences` (`tag_id`,`count`);
--> statement-breakpoint
CREATE INDEX `tag_cooccurrences_related_count_idx`
  ON `tag_cooccurrences` (`related_tag_id`,`count`);
