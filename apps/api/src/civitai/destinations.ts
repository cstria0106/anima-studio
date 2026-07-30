import { isAbsolute, relative, resolve, sep } from "node:path";
import { lstat, realpath } from "node:fs/promises";
import { CivitaiError, assertCivitai } from "./errors";
import type {
  CivitaiModelKind,
  DestinationRootConfig,
  DestinationRootOption,
  ModelDestinationKind,
  ResolvedDestination,
} from "./types";

const validRootId = /^[a-z][a-z0-9_-]{0,63}$/;
const invalidWindowsSegment = /[<>:"|?*\u0000-\u001f]/;
const reservedWindowsName =
  /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

function isContained(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return (
    pathFromRoot === "" ||
    (!pathFromRoot.startsWith(`..${sep}`) &&
      pathFromRoot !== ".." &&
      !isAbsolute(pathFromRoot))
  );
}

function normalizeRelativeDirectory(value: string): string {
  const input = value.trim().replaceAll("\\", "/");
  if (!input) return "";
  assertCivitai(
    input.length <= 512 &&
      !input.startsWith("/") &&
      !/^[a-z]:/i.test(input),
    "INVALID_DESTINATION",
    "The destination folder must be relative to a managed model root.",
  );

  const segments = input.split("/");
  assertCivitai(
    segments.every(
      (segment) =>
        segment.length > 0 &&
        segment !== "." &&
        segment !== ".." &&
        segment.length <= 120 &&
        !invalidWindowsSegment.test(segment) &&
        !reservedWindowsName.test(segment) &&
        !/[. ]$/.test(segment),
    ),
    "INVALID_DESTINATION",
    "The destination folder contains an invalid path segment.",
  );
  return segments.join("/");
}

function supportsKind(
  destination: ModelDestinationKind,
  model: CivitaiModelKind,
): boolean {
  return model === "lora"
    ? destination === "loras"
    : destination === "checkpoints" ||
        destination === "diffusion_models";
}

/**
 * Maps API-safe root IDs to server-owned absolute paths. Callers cannot submit
 * an absolute destination path.
 */
export class DestinationRegistry {
  private readonly roots = new Map<string, DestinationRootConfig>();

  constructor(configs: readonly DestinationRootConfig[]) {
    for (const config of configs) {
      assertCivitai(
        validRootId.test(config.id),
        "INVALID_DESTINATION",
        "Destination root IDs must be stable lowercase identifiers.",
        500,
      );
      assertCivitai(
        isAbsolute(config.absolutePath),
        "INVALID_DESTINATION",
        `Destination root ${config.id} must use an absolute path.`,
        500,
      );
      const absolutePath = resolve(config.absolutePath);
      assertCivitai(
        resolve(absolutePath, "..") !== absolutePath,
        "INVALID_DESTINATION",
        `Destination root ${config.id} cannot be a filesystem root.`,
        500,
      );
      assertCivitai(
        !this.roots.has(config.id),
        "INVALID_DESTINATION",
        `Duplicate destination root ID: ${config.id}.`,
        500,
      );
      this.roots.set(config.id, { ...config, absolutePath });
    }
  }

  options(): DestinationRootOption[] {
    return [...this.roots.values()].map(({ id, label, kind }) => ({
      id,
      label,
      kind,
    }));
  }

  resolve(
    rootId: string,
    modelKind: CivitaiModelKind,
    relativeDirectory = "",
  ): ResolvedDestination {
    const root = this.roots.get(rootId);
    if (!root) {
      throw new CivitaiError(
        "INVALID_DESTINATION",
        "The selected model destination is not available.",
        400,
      );
    }
    assertCivitai(
      supportsKind(root.kind, modelKind),
      "INVALID_DESTINATION",
      `The selected destination cannot store ${modelKind} models.`,
    );
    const normalized = normalizeRelativeDirectory(relativeDirectory);
    const absoluteDirectory = normalized
      ? resolve(root.absolutePath, ...normalized.split("/"))
      : root.absolutePath;
    assertCivitai(
      isContained(root.absolutePath, absoluteDirectory),
      "INVALID_DESTINATION",
      "The destination escapes its managed model root.",
    );
    return {
      rootId: root.id,
      kind: root.kind,
      absoluteRoot: root.absolutePath,
      absoluteDirectory,
      relativeDirectory: normalized,
    };
  }

  assertFinalFile(
    destination: ResolvedDestination,
    filePath: string,
  ): string {
    assertCivitai(
      isAbsolute(filePath),
      "DOWNLOAD_FAILED",
      "LoRA Manager returned an invalid download path.",
      502,
    );
    const candidate = resolve(filePath);
    assertCivitai(
      isContained(destination.absoluteDirectory, candidate),
      "DOWNLOAD_FAILED",
      "LoRA Manager returned a file outside the selected destination.",
      502,
    );
    assertCivitai(
      candidate.toLowerCase().endsWith(".safetensors"),
      "UNSUPPORTED_FILE",
      "Only .safetensors model files may enter the model library.",
      502,
    );
    return candidate;
  }

  async verifyFinalFile(
    destination: ResolvedDestination,
    filePath: string,
  ): Promise<string> {
    const candidate = this.assertFinalFile(destination, filePath);
    let rootRealPath: string;
    let candidateRealPath: string;
    try {
      const stats = await lstat(candidate);
      assertCivitai(
        stats.isFile() && !stats.isSymbolicLink(),
        "DOWNLOAD_FAILED",
        "LoRA Manager did not return a regular model file.",
        502,
      );
      [rootRealPath, candidateRealPath] = await Promise.all([
        realpath(destination.absoluteDirectory),
        realpath(candidate),
      ]);
    } catch (error) {
      if (error instanceof CivitaiError) throw error;
      throw new CivitaiError(
        "DOWNLOAD_FAILED",
        "The downloaded model file could not be located.",
        502,
      );
    }
    assertCivitai(
      isContained(rootRealPath, candidateRealPath),
      "DOWNLOAD_FAILED",
      "The downloaded model file resolves outside its managed destination.",
      502,
    );
    return candidateRealPath;
  }
}

export { normalizeRelativeDirectory };
