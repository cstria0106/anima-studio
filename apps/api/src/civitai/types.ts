export const CIVITAI_PAGE_HOSTS = [
  "civitai.com",
  "civitai.red",
] as const;

export type CivitaiPageHost = (typeof CIVITAI_PAGE_HOSTS)[number];
export type CivitaiModelKind = "lora" | "checkpoint";
export type ModelDestinationKind =
  | "loras"
  | "checkpoints"
  | "diffusion_models";

export interface CivitaiModelReference {
  provider: "civitai";
  host: CivitaiPageHost;
  modelId: number;
  modelVersionId: number | null;
  canonicalUrl: string;
  unrestrictedSource: boolean;
}

export type CivitaiFileBlockReason =
  | "unsupported_file_type"
  | "unsafe_filename"
  | "not_safetensors"
  | "unsafe_scan_result"
  | "missing_sha256"
  | "invalid_file_id";

export interface CivitaiFileInspection {
  id: number | null;
  name: string;
  sizeBytes: number | null;
  remoteType: string;
  format: string | null;
  precision: string | null;
  sizeVariant: string | null;
  primary: boolean;
  sha256: string | null;
  eligible: boolean;
  blockReason: CivitaiFileBlockReason | null;
}

export interface CivitaiVersionInspection {
  id: number;
  name: string;
  baseModel: string | null;
  createdAt: string | null;
  publishedAt: string | null;
  earlyAccessEndsAt: string | null;
  triggerWords: string[];
  files: CivitaiFileInspection[];
}

export interface CivitaiLicenseSnapshot {
  allowNoCredit: boolean | null;
  allowCommercialUse: string[];
  allowDerivatives: boolean | null;
  allowDifferentLicense: boolean | null;
}

export interface CivitaiModelInspection {
  reference: CivitaiModelReference;
  modelId: number;
  name: string;
  kind: CivitaiModelKind;
  creator: string | null;
  tags: string[];
  nsfw: boolean;
  license: CivitaiLicenseSnapshot;
  versions: CivitaiVersionInspection[];
}

export interface SecretStore {
  read(key: string): Promise<string | null>;
  write(key: string, secret: string): Promise<void>;
  remove(key: string): Promise<void>;
  has(key: string): Promise<boolean>;
}

export interface CivitaiTokenStatus {
  tokenConfigured: boolean;
}

export interface DestinationRootConfig {
  id: string;
  label: string;
  kind: ModelDestinationKind;
  absolutePath: string;
}

export interface DestinationRootOption {
  id: string;
  label: string;
  kind: ModelDestinationKind;
}

export interface ResolvedDestination {
  rootId: string;
  kind: ModelDestinationKind;
  absoluteRoot: string;
  absoluteDirectory: string;
  relativeDirectory: string;
}

export type ModelDownloadState =
  | "queued"
  | "downloading"
  | "paused"
  | "verifying"
  | "completed"
  | "failed"
  | "cancelled";

export interface ModelDownloadProgress {
  downloadId: string;
  state: ModelDownloadState;
  percent: number;
  bytesDownloaded: number | null;
  totalBytes: number | null;
  bytesPerSecond: number | null;
}

export interface ModelDownloadRequest {
  sourceUrl: string;
  versionId: number;
  fileId: number;
  destinationRootId: string;
  relativeDirectory?: string;
  downloadId?: string;
}

export interface ModelDownloadResult {
  downloadId: string;
  status: "completed";
  modelId: number;
  versionId: number;
  fileId: number;
  modelKind: CivitaiModelKind;
  destinationRootId: string;
  relativeDirectory: string;
  filename: string;
  sha256: string;
  triggerWords: string[];
  license: CivitaiLicenseSnapshot;
}
