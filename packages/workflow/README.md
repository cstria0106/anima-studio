# `@anima/workflow`

Portable ComfyUI API-prompt builder for the Anima Instant Reference workflow.
The package does not read ComfyUI history or workflow files.

```ts
import {
  buildWorkflow,
  inspectCapabilities,
  requiredNodes,
} from "@anima/workflow";

const capabilities = inspectCapabilities(await fetchObjectInfo());
if (!capabilities.compatible) {
  // Present capabilities.missing / capabilities.incompatible to the user.
}

const built = buildWorkflow(config, uploadedComfyInputNames);
await queuePrompt(built.prompt);
```

`uploadedComfyInputNames` must contain the relative names returned by
ComfyUI's image upload endpoint, in the same order as
`config.referenceAssetIds`. `buildWorkflow` returns the resolved seed,
node-to-progress-phase mappings, and SaveImage node-to-output-kind mappings so
the API server can persist and track the job without understanding graph
internals. The `autoTagsNodeId` identifies the core `SaveText` output whose
history payload/file contains the InstantReference tagger result.

The install sources and exact `/object_info` contracts are versioned in
`custom-nodes.manifest.json`.

Prompt concatenation is intentionally completed before queue submission:
`basePositive`, `positive`, and `natural` are joined directly into the
positive `CLIPTextEncode`; the two negative fields are handled the same way.
LoRA trigger words selected by the user should therefore be inserted into one
of those UI prompt fields before calling `buildWorkflow`. InstantReference
auto-tags are preserved as a separate `SaveText` result for inspection and
reuse, rather than being joined through a runtime string node.
