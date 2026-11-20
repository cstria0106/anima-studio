/**
 * The SnapRef reference adapter is a single pinned file. It is downloaded only
 * when the user installs it, verified against its Git LFS SHA-256, and stored
 * in the LoRA root because the SnapRef node lists its weights from there.
 */
export const SNAPREF_REPOSITORY = "0ppxnhximxr/snapref-v2a" as const;
export const SNAPREF_REVISION = "e6d6a21e4d56faae4454a1cc9bfd065d87358bf2";
export const SNAPREF_SOURCE_URL = `https://huggingface.co/${SNAPREF_REPOSITORY}`;
export const SNAPREF_LICENSE = "circlestone-labs-non-commercial-license";
export const SNAPREF_FILE = Object.freeze({
  path: "snapref_v2a.safetensors",
  filename: "snapref_v2a.safetensors",
  sizeBytes: 381_821_960,
  sha256: "8a22fc28d060447544eda283b36efe2dcdbad7422cbc0b8d42828d55a8a61ab4",
});
