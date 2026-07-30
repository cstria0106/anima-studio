import { validateEngineManifest } from "./validation";

const GiB = 1024 ** 3;

/**
 * The archive digests below are release inputs, not values discovered at
 * install time. Every artifact is downloaded by immutable tag/commit URL and
 * rejected before extraction when its byte length or SHA-256 differs.
 */
export const MANAGED_ENGINE_MANIFEST = validateEngineManifest({
  schemaVersion: 1,
  bundleId: "anima-comfy-0.29.0-win-nvidia-r3",
  displayName: "Anima ComfyUI 0.29.0 (Windows NVIDIA)",
  platform: {
    os: "win32",
    architecture: "x64",
    accelerator: "nvidia",
    minimumFreeBytes: 25 * GiB,
    recommendedVramMiB: 16 * 1024,
  },
  launch: {
    executable: "python_embeded/python.exe",
    entrypoint: "ComfyUI/main.py",
    arguments: [
      "-s",
      "{entrypoint}",
      "--listen",
      "{host}",
      "--port",
      "{port}",
      "--input-directory",
      "{input}",
      "--output-directory",
      "{output}",
      "--temp-directory",
      "{temp}",
      "--user-directory",
      "{user}",
      "--extra-model-paths-config",
      "{modelPathsConfig}",
      "--preview-method",
      "auto",
      "--preview-size",
      "512",
      "--disable-auto-launch",
      "--disable-all-custom-nodes",
      "--whitelist-custom-nodes",
      "comfyui-instant-reference",
      "ComfyUI-KJNodes",
      "ComfyUI-Lora-Manager",
      "ComfyUI-LoRA-Optimizer",
    ],
    host: "127.0.0.1",
    portRange: { from: 8188, to: 8199 },
    readinessTimeoutMs: 120_000,
  },
  sharedDirectories: [
    "input",
    "output",
    "temp",
    "user",
    "models",
    "cache",
  ],
  artifacts: [
    {
      id: "7zr",
      kind: "tool",
      name: "7-Zip reduced command-line tool",
      version: "26.02",
      revision: "f9d78aff31a5f2521ae7ddbdc97c4a8855808959",
      downloadUrl:
        "https://github.com/ip7z/7zip/releases/download/26.02/7zr.exe",
      sourceUrl:
        "https://github.com/ip7z/7zip/tree/f9d78aff31a5f2521ae7ddbdc97c4a8855808959",
      bytes: 602_112,
      sha256:
        "56b8cc9f4971cef253644fafe54063ed7fdca551d4dee0f8c6baa81b855acd72",
      license: "LGPL-2.1-or-later AND BSD-3-Clause",
      archive: { format: "raw", stripComponents: 0 },
      destination: "_managed/tools/7zr.exe",
    },
    {
      id: "comfyui",
      kind: "engine",
      name: "ComfyUI Windows portable NVIDIA",
      version: "0.29.0",
      revision: "a8c44f9b2a0678ac4082e3529a3f43db7472acfe",
      downloadUrl:
        "https://github.com/Comfy-Org/ComfyUI/releases/download/v0.29.0/ComfyUI_windows_portable_nvidia.7z",
      sourceUrl:
        "https://github.com/Comfy-Org/ComfyUI/tree/a8c44f9b2a0678ac4082e3529a3f43db7472acfe",
      bytes: 2_099_072_277,
      sha256:
        "a1a9c2fd8d8c564c0fc2408a486b7898b6c18f6c82561ded248a53d3c05b7825",
      license: "GPL-3.0",
      archive: { format: "7z", stripComponents: 1 },
      destination: ".",
    },
    {
      id: "python312",
      kind: "training-runtime",
      name: "Python build standalone",
      version: "3.12.13+20260728",
      revision: "c1991f8fc3eb8774907f0cffb93792f59079cd7a",
      downloadUrl:
        "https://github.com/astral-sh/python-build-standalone/releases/download/20260728/cpython-3.12.13%2B20260728-x86_64-pc-windows-msvc-install_only_stripped.tar.gz",
      sourceUrl:
        "https://github.com/astral-sh/python-build-standalone/tree/c1991f8fc3eb8774907f0cffb93792f59079cd7a",
      bytes: 21_932_566,
      sha256:
        "242b94b37682ac55f9bf9eb624348dc8d17c64f74f56028104545ea3ffe35e26",
      license: "PSF-2.0 (build tooling MPL-2.0)",
      archive: { format: "tar.gz", stripComponents: 1 },
      destination: "_managed/python312",
    },
    {
      id: "uv",
      kind: "tool",
      name: "uv",
      version: "0.12.0",
      revision: "b88d7c5c46cbe3c9896544f10255f85a8f0a8a5e",
      downloadUrl:
        "https://github.com/astral-sh/uv/releases/download/0.12.0/uv-x86_64-pc-windows-msvc.zip",
      sourceUrl:
        "https://github.com/astral-sh/uv/tree/b88d7c5c46cbe3c9896544f10255f85a8f0a8a5e",
      bytes: 18_813_141,
      sha256:
        "68200e25de594df92387186bbfb9d9df606ec1d87efaa0ae0c7f690970e53db6",
      license: "Apache-2.0 OR MIT",
      archive: { format: "zip", stripComponents: 0 },
      destination: "_managed/tools/uv",
    },
    {
      id: "instant-reference",
      kind: "custom-node",
      name: "ComfyUI Instant Reference",
      version: "0.1.14",
      revision: "183ca3b250b7742e7b25a11475643721e0fb1ee6",
      downloadUrl:
        "https://codeload.github.com/cstria0106/comfyui-instant-reference/zip/183ca3b250b7742e7b25a11475643721e0fb1ee6",
      sourceUrl:
        "https://github.com/cstria0106/comfyui-instant-reference/tree/183ca3b250b7742e7b25a11475643721e0fb1ee6",
      bytes: 3_674_877,
      sha256:
        "0d059603bba78c7b5b9cde992f4caec1239f5599d6d3cd32105b1e3a42c3d262",
      license: "MIT",
      archive: { format: "zip", stripComponents: 1 },
      destination: "ComfyUI/custom_nodes/comfyui-instant-reference",
    },
    {
      id: "kjnodes",
      kind: "custom-node",
      name: "ComfyUI KJNodes",
      version: "1.3.3",
      revision: "faf270a25dde1c57afbb49e04010fe8993ca07df",
      downloadUrl:
        "https://codeload.github.com/kijai/ComfyUI-KJNodes/zip/faf270a25dde1c57afbb49e04010fe8993ca07df",
      sourceUrl:
        "https://github.com/kijai/ComfyUI-KJNodes/tree/faf270a25dde1c57afbb49e04010fe8993ca07df",
      bytes: 24_774_900,
      sha256:
        "59856fdc07a2eeb746042f47d4732e0250357a6b2581e82c12b361dd0863b63a",
      license: "GPL-3.0",
      archive: { format: "zip", stripComponents: 1 },
      destination: "ComfyUI/custom_nodes/ComfyUI-KJNodes",
    },
    {
      id: "lora-manager",
      kind: "custom-node",
      name: "ComfyUI LoRA Manager",
      version: "1.0.6",
      revision: "3631c5eb106bc0374a3b36c72ecb4d8b4966d16a",
      downloadUrl:
        "https://codeload.github.com/willmiao/ComfyUI-Lora-Manager/zip/3631c5eb106bc0374a3b36c72ecb4d8b4966d16a",
      sourceUrl:
        "https://github.com/willmiao/ComfyUI-Lora-Manager/tree/3631c5eb106bc0374a3b36c72ecb4d8b4966d16a",
      bytes: 16_126_776,
      sha256:
        "46bc7112083d70a221e2c70460507922c9d502399c1cf0c665b6a2b00cdb623b",
      license: "GPL-3.0",
      archive: { format: "zip", stripComponents: 1 },
      destination: "ComfyUI/custom_nodes/ComfyUI-Lora-Manager",
    },
    {
      id: "lora-optimizer",
      kind: "custom-node",
      name: "ComfyUI LoRA Optimizer",
      version: "1.4.5",
      revision: "4ddb2cbd2109f0ce6fba85c36ea29316fbf0058e",
      downloadUrl:
        "https://codeload.github.com/ethanfel/ComfyUI-LoRA-Optimizer/zip/4ddb2cbd2109f0ce6fba85c36ea29316fbf0058e",
      sourceUrl:
        "https://github.com/ethanfel/ComfyUI-LoRA-Optimizer/tree/4ddb2cbd2109f0ce6fba85c36ea29316fbf0058e",
      bytes: 29_412_244,
      sha256:
        "4c6197986d695c325eb6f2c229cff7bc8e4bde57b67a9baa4e266855c434b108",
      license: "MIT",
      archive: { format: "zip", stripComponents: 1 },
      destination: "ComfyUI/custom_nodes/ComfyUI-LoRA-Optimizer",
    },
    {
      id: "sd-scripts",
      kind: "training-runtime",
      name: "kohya sd-scripts",
      version: "2026-02-25",
      revision: "1a3ec9ea745fe9883551dfca5c947ea3d6aa68c7",
      downloadUrl:
        "https://codeload.github.com/kohya-ss/sd-scripts/zip/1a3ec9ea745fe9883551dfca5c947ea3d6aa68c7",
      sourceUrl:
        "https://github.com/kohya-ss/sd-scripts/tree/1a3ec9ea745fe9883551dfca5c947ea3d6aa68c7",
      bytes: 12_425_974,
      sha256:
        "310a774a3d17600ead75f3c324fd8f1685996a139d1ccfed86e645e3533cacc1",
      license: "Apache-2.0",
      archive: { format: "zip", stripComponents: 1 },
      destination:
        "ComfyUI/custom_nodes/comfyui-instant-reference/runtime/sd-scripts",
    },
    {
      id: "wd14-model",
      kind: "tagger-model",
      name: "WD 1.4 ConvNeXT Tagger v2 ONNX",
      version: "4b34d1b",
      revision: "4b34d1b07bdd8e95494072648960b8a6adcbc0ff",
      downloadUrl:
        "https://huggingface.co/SmilingWolf/wd-v1-4-convnext-tagger-v2/resolve/4b34d1b07bdd8e95494072648960b8a6adcbc0ff/model.onnx",
      sourceUrl:
        "https://huggingface.co/SmilingWolf/wd-v1-4-convnext-tagger-v2/tree/4b34d1b07bdd8e95494072648960b8a6adcbc0ff",
      bytes: 387_820_405,
      sha256:
        "71f06ecb7b9df81d8f271da4d43997ea2ed363cdac29aa64fcb256c9631e656a",
      license: "Apache-2.0",
      archive: { format: "raw", stripComponents: 0 },
      destination:
        "ComfyUI/custom_nodes/comfyui-instant-reference/runtime/sd-scripts/wd14_tagger_model/SmilingWolf_wd-v1-4-convnext-tagger-v2/model.onnx",
    },
    {
      id: "wd14-tags",
      kind: "tagger-model",
      name: "WD 1.4 ConvNeXT Tagger v2 labels",
      version: "4b34d1b",
      revision: "4b34d1b07bdd8e95494072648960b8a6adcbc0ff",
      downloadUrl:
        "https://huggingface.co/SmilingWolf/wd-v1-4-convnext-tagger-v2/resolve/4b34d1b07bdd8e95494072648960b8a6adcbc0ff/selected_tags.csv",
      sourceUrl:
        "https://huggingface.co/SmilingWolf/wd-v1-4-convnext-tagger-v2/tree/4b34d1b07bdd8e95494072648960b8a6adcbc0ff",
      bytes: 253_906,
      sha256:
        "8c8750600db36233a1b274ac88bd46289e588b338218c2e4c62bbc9f2b516368",
      license: "Apache-2.0",
      archive: { format: "raw", stripComponents: 0 },
      destination:
        "ComfyUI/custom_nodes/comfyui-instant-reference/runtime/sd-scripts/wd14_tagger_model/SmilingWolf_wd-v1-4-convnext-tagger-v2/selected_tags.csv",
    },
  ],
});

export const MANAGED_BUNDLE_ID = MANAGED_ENGINE_MANIFEST.bundleId;
