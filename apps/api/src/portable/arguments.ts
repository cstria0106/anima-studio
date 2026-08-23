import { isIPv4 } from "node:net";
import { PORTABLE_APP_HOST } from "./network";

export interface PortableArguments {
  host: string;
  port: number | undefined;
  noBrowser: boolean;
  version: boolean;
}

function optionValue(
  args: string[],
  index: number,
  option: "--host" | "--port",
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

    throw new Error(`Unknown option: ${argument}`);
  }

  return { host, port, noBrowser, version };
}
