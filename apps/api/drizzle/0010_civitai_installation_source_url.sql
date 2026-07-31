ALTER TABLE `managed_model_installations`
ADD `source_url` text;
--> statement-breakpoint
UPDATE `managed_model_installations`
SET `source_url` =
  'https://civitai.com/models/' || `provider_model_id` ||
  '?modelVersionId=' || `provider_version_id`
WHERE `provider` = 'civitai'
  AND trim(`provider_model_id`) <> ''
  AND trim(`provider_version_id`) <> '';
