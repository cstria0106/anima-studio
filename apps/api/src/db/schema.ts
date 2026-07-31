import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  valueJson: text("value_json").notNull(),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const assets = sqliteTable(
  "assets",
  {
    id: text("id").primaryKey(),
    sha256: text("sha256").notNull(),
    originalName: text("original_name").notNull(),
    mimeType: text("mime_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    width: integer("width"),
    height: integer("height"),
    storagePath: text("storage_path").notNull(),
    comfyFilename: text("comfy_filename"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("assets_sha256_unique").on(table.sha256),
    index("assets_created_at_idx").on(table.createdAt),
  ],
);

export const jobs = sqliteTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    kind: text("kind").notNull().default("generation"),
    parentJobId: text("parent_job_id"),
    sourceOutputId: text("source_output_id"),
    status: text("status").notNull(),
    phase: text("phase").notNull(),
    comfyPromptId: text("comfy_prompt_id"),
    comfyClientId: text("comfy_client_id").notNull(),
    queueNumber: integer("queue_number"),
    configJson: text("config_json").notNull(),
    workflowJson: text("workflow_json"),
    nodePhasesJson: text("node_phases_json"),
    nodeLabelsJson: text("node_labels_json"),
    outputKindsJson: text("output_kinds_json"),
    autoTagsNodeId: text("auto_tags_node_id"),
    actualSeed: integer("actual_seed").notNull(),
    autoTags: text("auto_tags").notNull().default(""),
    error: text("error"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    startedAt: text("started_at"),
    completedAt: text("completed_at"),
  },
  (table) => [
    uniqueIndex("jobs_comfy_prompt_id_unique").on(table.comfyPromptId),
    index("jobs_status_idx").on(table.status),
    index("jobs_parent_job_id_idx").on(table.parentJobId),
    index("jobs_created_at_idx").on(table.createdAt),
  ],
);

export const jobAssets = sqliteTable(
  "job_assets",
  {
    jobId: text("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    assetId: text("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "restrict" }),
    ordinal: integer("ordinal").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.jobId, table.assetId] }),
    uniqueIndex("job_assets_ordinal_unique").on(table.jobId, table.ordinal),
  ],
);

export const jobEvents = sqliteTable(
  "job_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    jobId: text("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    phase: text("phase").notNull(),
    message: text("message").notNull(),
    progress: integer("progress"),
    current: integer("current"),
    total: integer("total"),
    payloadJson: text("payload_json"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("job_events_job_id_id_idx").on(table.jobId, table.id),
    index("job_events_created_at_idx").on(table.createdAt),
  ],
);

export const outputs = sqliteTable(
  "outputs",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    nodeId: text("node_id").notNull(),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    width: integer("width"),
    height: integer("height"),
    storagePath: text("storage_path").notNull(),
    comfyFilename: text("comfy_filename").notNull(),
    comfySubfolder: text("comfy_subfolder").notNull().default(""),
    comfyType: text("comfy_type").notNull().default("output"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("outputs_comfy_file_unique").on(
      table.jobId,
      table.nodeId,
      table.comfyFilename,
      table.comfySubfolder,
    ),
    index("outputs_job_id_idx").on(table.jobId),
  ],
);

export const tags = sqliteTable(
  "tags",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    tag: text("tag").notNull(),
    category: text("category").notNull(),
    count: integer("count").notNull().default(0),
    description: text("description").notNull().default(""),
    aliases: text("aliases").notNull().default(""),
  },
  (table) => [
    uniqueIndex("tags_tag_unique").on(table.tag),
    index("tags_count_idx").on(table.count),
  ],
);

export const tagCooccurrences = sqliteTable(
  "tag_cooccurrences",
  {
    tagId: integer("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
    relatedTagId: integer("related_tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
    count: integer("count").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.tagId, table.relatedTagId] }),
    index("tag_cooccurrences_tag_count_idx").on(table.tagId, table.count),
    index("tag_cooccurrences_related_count_idx").on(
      table.relatedTagId,
      table.count,
    ),
  ],
);

export const systemOperations = sqliteTable(
  "system_operations",
  {
    id: text("id").primaryKey(),
    kind: text("kind").notNull(),
    status: text("status").notNull(),
    phase: text("phase").notNull(),
    message: text("message").notNull().default(""),
    progress: integer("progress"),
    metadataJson: text("metadata_json").notNull().default("{}"),
    error: text("error"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    startedAt: text("started_at"),
    completedAt: text("completed_at"),
  },
  (table) => [
    index("system_operations_status_idx").on(table.status),
    index("system_operations_kind_created_idx").on(
      table.kind,
      table.createdAt,
    ),
  ],
);

export const systemOperationEvents = sqliteTable(
  "system_operation_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    operationId: text("operation_id")
      .notNull()
      .references(() => systemOperations.id, { onDelete: "cascade" }),
    phase: text("phase").notNull(),
    message: text("message").notNull(),
    progress: integer("progress"),
    current: integer("current"),
    total: integer("total"),
    bytesCompleted: integer("bytes_completed"),
    bytesTotal: integer("bytes_total"),
    bytesPerSecond: integer("bytes_per_second"),
    payloadJson: text("payload_json"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("system_operation_events_operation_id_idx").on(
      table.operationId,
      table.id,
    ),
  ],
);

export const runtimeSessions = sqliteTable(
  "runtime_sessions",
  {
    id: text("id").primaryKey(),
    bundleId: text("bundle_id").notNull(),
    pid: integer("pid").notNull(),
    executablePath: text("executable_path").notNull(),
    commandJson: text("command_json").notNull(),
    port: integer("port").notNull(),
    logPath: text("log_path").notNull(),
    status: text("status").notNull(),
    startedAt: text("started_at").notNull(),
    stoppedAt: text("stopped_at"),
    exitCode: integer("exit_code"),
  },
  (table) => [
    index("runtime_sessions_status_idx").on(table.status),
    index("runtime_sessions_started_at_idx").on(table.startedAt),
  ],
);

export const modelDownloads = sqliteTable(
  "model_downloads",
  {
    id: text("id").primaryKey(),
    operationId: text("operation_id")
      .notNull()
      .references(() => systemOperations.id, { onDelete: "cascade" }),
    state: text("state").notNull(),
    provider: text("provider").notNull().default("civitai"),
    providerDownloadId: text("provider_download_id"),
    providerModelId: text("provider_model_id").notNull(),
    providerVersionId: text("provider_version_id").notNull(),
    providerFileId: text("provider_file_id"),
    modelId: integer("model_id"),
    modelVersionId: integer("model_version_id"),
    fileId: integer("file_id"),
    modelName: text("model_name").notNull(),
    versionName: text("version_name").notNull(),
    filename: text("filename").notNull(),
    destinationRootId: text("destination_root_id").notNull(),
    relativeDir: text("relative_dir").notNull().default(""),
    expectedSha256: text("expected_sha256"),
    actualSha256: text("actual_sha256"),
    bytesCompleted: integer("bytes_completed").notNull().default(0),
    bytesTotal: integer("bytes_total"),
    bytesPerSecond: integer("bytes_per_second"),
    triggerWordsJson: text("trigger_words_json").notNull().default("[]"),
    metadataJson: text("metadata_json").notNull().default("{}"),
    storagePath: text("storage_path"),
    error: text("error"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    completedAt: text("completed_at"),
  },
  (table) => [
    uniqueIndex("model_downloads_operation_id_unique").on(table.operationId),
    index("model_downloads_state_idx").on(table.state),
    index("model_downloads_created_at_idx").on(table.createdAt),
    index("model_downloads_version_idx").on(
      table.modelId,
      table.modelVersionId,
    ),
    index("model_downloads_provider_file_idx").on(
      table.provider,
      table.providerModelId,
      table.providerVersionId,
      table.providerFileId,
    ),
  ],
);

export const managedModelInstallations = sqliteTable(
  "managed_model_installations",
  {
    id: text("id").primaryKey(),
    provider: text("provider").notNull(),
    sourceUrl: text("source_url"),
    providerModelId: text("provider_model_id").notNull(),
    providerVersionId: text("provider_version_id").notNull(),
    providerFileId: text("provider_file_id"),
    modelName: text("model_name").notNull(),
    versionName: text("version_name").notNull(),
    filename: text("filename").notNull(),
    destinationRootId: text("destination_root_id").notNull(),
    relativeDir: text("relative_dir").notNull().default(""),
    sha256: text("sha256").notNull(),
    storagePath: text("storage_path").notNull(),
    installedAt: text("installed_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("managed_model_installations_provider_file_unique").on(
      table.provider,
      table.providerModelId,
      table.providerVersionId,
      table.providerFileId,
    ),
    uniqueIndex("managed_model_installations_storage_path_unique").on(
      table.storagePath,
    ),
    index("managed_model_installations_installed_at_idx").on(
      table.installedAt,
    ),
  ],
);

export type AssetRow = typeof assets.$inferSelect;
export type JobRow = typeof jobs.$inferSelect;
export type JobEventRow = typeof jobEvents.$inferSelect;
export type OutputRow = typeof outputs.$inferSelect;
export type SystemOperationRow = typeof systemOperations.$inferSelect;
export type SystemOperationEventRow =
  typeof systemOperationEvents.$inferSelect;
export type RuntimeSessionRow = typeof runtimeSessions.$inferSelect;
export type ModelDownloadRow = typeof modelDownloads.$inferSelect;
export type ManagedModelInstallationRow =
  typeof managedModelInstallations.$inferSelect;
