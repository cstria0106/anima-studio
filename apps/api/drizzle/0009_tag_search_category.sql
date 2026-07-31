DROP TRIGGER IF EXISTS `tags_after_insert`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `tags_after_delete`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `tags_after_update`;
--> statement-breakpoint
DROP TABLE IF EXISTS `tag_search`;
--> statement-breakpoint
CREATE VIRTUAL TABLE `tag_search` USING fts5(
  `tag`,
  `category`,
  `description`,
  `aliases`,
  content='tags',
  content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);
--> statement-breakpoint
CREATE TRIGGER `tags_after_insert` AFTER INSERT ON `tags` BEGIN
  INSERT INTO `tag_search`(rowid, tag, category, description, aliases)
  VALUES (new.id, new.tag, new.category, new.description, new.aliases);
END;
--> statement-breakpoint
CREATE TRIGGER `tags_after_delete` AFTER DELETE ON `tags` BEGIN
  INSERT INTO `tag_search`(
    `tag_search`, rowid, tag, category, description, aliases
  ) VALUES (
    'delete', old.id, old.tag, old.category, old.description, old.aliases
  );
END;
--> statement-breakpoint
CREATE TRIGGER `tags_after_update` AFTER UPDATE ON `tags` BEGIN
  INSERT INTO `tag_search`(
    `tag_search`, rowid, tag, category, description, aliases
  ) VALUES (
    'delete', old.id, old.tag, old.category, old.description, old.aliases
  );
  INSERT INTO `tag_search`(rowid, tag, category, description, aliases)
  VALUES (new.id, new.tag, new.category, new.description, new.aliases);
END;
--> statement-breakpoint
INSERT INTO `tag_search`(`tag_search`) VALUES ('rebuild');
