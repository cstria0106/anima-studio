import { join } from "node:path";

import type { RuntimePaths } from "./types";

export function resolveRuntimePaths(dataDirectory: string): RuntimePaths {
  return resolveRuntimeRootPaths(join(dataDirectory, "runtime"));
}

export function resolveRuntimeRootPaths(root: string): RuntimePaths {
  const shared = join(root, "shared");
  return {
    root,
    releases: join(root, "releases"),
    downloads: join(root, "downloads"),
    shared,
    logs: join(root, "logs"),
    input: join(shared, "input"),
    output: join(shared, "output"),
    temp: join(shared, "temp"),
    user: join(shared, "user"),
    models: join(shared, "models"),
    cache: join(shared, "cache"),
  };
}
