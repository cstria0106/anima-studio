import { FlatCompat } from "@eslint/eslintrc";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const directory = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const nextConfigDirectory = dirname(
  require.resolve("eslint-config-next/package.json"),
);
const compat = new FlatCompat({
  baseDirectory: directory,
  resolvePluginsRelativeTo: nextConfigDirectory,
});

const config = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      ".next*/**",
      "node_modules/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
    ],
  },
];

export default config;
