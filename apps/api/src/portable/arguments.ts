import { isIPv4 } from "node:net";
import { PORTABLE_APP_HOST } from "./network";

export interface PortableArguments {
  host: string;
  port: number | undefined;
  allowedOrigins: string[];
  noBrowser: boolean;
  version: boolean;
}

function parseAllowedOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Invalid origin for --allow-origin: ${value}`);
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    value.includes("?") ||
    value.includes("#")
  ) {
    throw new Error(
      `Invalid origin for --allow-origin: ${value} (expected http(s)://host[:port])`,
    );
  }
  return url.origin;
}

function optionValue(
  args: string[],
  index: number,
  option: "--host" | "--port" | "--allow-origin",
): { value: string; nextIndex: number } | null {
  const argument = args[index]!;
  if (argument === option) {
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${option} requires a value.`);
    }
    return { value, nextIndex: index + 1 };
  }
  const prefix = `${option}=`;
  if (!argument.startsWith(prefix)) return null;
  const value = argument.slice(prefix.length);
  if (!value) throw new Error(`${option} requires a value.`);
  return { value, nextIndex: index };
}

export function parsePortableArguments(args: string[]): PortableArguments {
  let host = PORTABLE_APP_HOST;
  let port: number | undefined;
  const allowedOrigins: string[] = [];
  let noBrowser = false;
  let version = false;
  const seen = new Set<string>();

  const markSeen = (option: string) => {
    if (seen.has(option)) throw new Error(`Duplicate option: ${option}`);
    seen.add(option);
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === "--no-browser") {
      markSeen("--no-browser");
      noBrowser = true;
      continue;
    }
    if (argument === "--version") {
      markSeen("--version");
      version = true;
      continue;
    }

    const hostOption = optionValue(args, index, "--host");
    if (hostOption) {
      markSeen("--host");
      if (!isIPv4(hostOption.value)) {
        throw new Error(`Invalid IPv4 address for --host: ${hostOption.value}`);
      }
      host = hostOption.value;
      index = hostOption.nextIndex;
      continue;
    }

    const portOption = optionValue(args, index, "--port");
    if (portOption) {
      markSeen("--port");
      if (!/^\d+$/.test(portOption.value)) {
        throw new Error(`Invalid TCP port for --port: ${portOption.value}`);
      }
      const parsed = Number(portOption.value);
      if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65_535) {
        throw new Error(`Invalid TCP port for --port: ${portOption.value}`);
      }
      port = parsed;
      index = portOption.nextIndex;
      continue;
    }

    const originOption = optionValue(args, index, "--allow-origin");
    if (originOption) {
      const origin = parseAllowedOrigin(originOption.value);
      if (!allowedOrigins.includes(origin)) allowedOrigins.push(origin);
      index = originOption.nextIndex;
      continue;
    }

    throw new Error(`Unknown option: ${argument}`);
  }

  return { host, port, allowedOrigins, noBrowser, version };
}
