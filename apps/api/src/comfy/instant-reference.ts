export const INSTANT_REFERENCE_GENERATED_LORA_DIRECTORY =
  "Instant-Reference-Generated";

export function isInstantReferenceGeneratedLora(value: string): boolean {
  const normalized = value.replaceAll("\\", "/").replace(/^\/+/, "");
  return normalized
    .toLowerCase()
    .startsWith(`${INSTANT_REFERENCE_GENERATED_LORA_DIRECTORY.toLowerCase()}/`);
}
