import type { EngineManifest } from "./types";

export function renderThirdPartyNotices(manifest: EngineManifest): string {
  const sections = manifest.artifacts.map((artifact) =>
    [
      `## ${artifact.name} ${artifact.version}`,
      "",
      `- License: ${artifact.license}`,
      `- Source: ${artifact.sourceUrl}`,
      `- Revision: ${artifact.revision}`,
      `- Distributed artifact SHA-256: ${artifact.sha256}`,
    ].join("\n"),
  );
  return [
    "# Third-Party Notices",
    "",
    `Runtime bundle: ${manifest.bundleId}`,
    "",
    "This inventory identifies the exact upstream sources used by the managed runtime. License texts distributed by each pinned archive remain authoritative.",
    "",
    ...sections.flatMap((section) => [section, ""]),
  ].join("\n");
}

export interface RuntimeSbom {
  bomFormat: "CycloneDX";
  specVersion: "1.5";
  serialNumber: string;
  version: 1;
  metadata: {
    component: {
      type: "application";
      name: string;
      version: string;
    };
  };
  components: Array<{
    type: "application" | "library";
    name: string;
    version: string;
    hashes: [{ alg: "SHA-256"; content: string }];
    licenses: [{ license: { id: string } }];
    externalReferences: [
      { type: "distribution"; url: string },
      { type: "vcs"; url: string },
    ];
  }>;
}

export function createRuntimeSbom(manifest: EngineManifest): RuntimeSbom {
  return {
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    serialNumber: `urn:uuid:${crypto.randomUUID()}`,
    version: 1,
    metadata: {
      component: {
        type: "application",
        name: manifest.displayName,
        version: manifest.bundleId,
      },
    },
    components: manifest.artifacts.map((artifact) => ({
      type: artifact.kind === "engine" ? "application" : "library",
      name: artifact.name,
      version: artifact.version,
      hashes: [{ alg: "SHA-256", content: artifact.sha256 }],
      licenses: [{ license: { id: artifact.license } }],
      externalReferences: [
        { type: "distribution", url: artifact.downloadUrl },
        { type: "vcs", url: artifact.sourceUrl },
      ],
    })),
  };
}
