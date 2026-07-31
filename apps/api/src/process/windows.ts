import { resolve } from "node:path";

export interface ObservedWindowsProcess {
  pid: number;
  executable: string;
  commandLine: string;
  startedAt: string;
}

export interface WindowsProcessIdentity {
  pid: number;
  executable: string;
  startedAt: string;
}

export interface WindowsProcessInspector {
  observe(pid: number): Promise<ObservedWindowsProcess | null>;
  terminateTree(pid: number, force: boolean): Promise<void>;
}

async function processOutput(
  command: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  const child = Bun.spawn(command, {
    stdout: "pipe",
    stderr: "pipe",
    windowsHide: true,
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, code };
}

export class CimWindowsProcessInspector implements WindowsProcessInspector {
  async observe(pid: number): Promise<ObservedWindowsProcess | null> {
    if (!Number.isSafeInteger(pid) || pid <= 0) return null;
    const script = [
      "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)",
      "$OutputEncoding = [Console]::OutputEncoding",
      `$p = Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}"`,
      "if ($null -eq $p) { exit 3 }",
      "$created = $p.CreationDate.ToUniversalTime().ToString('o')",
      "[pscustomobject]@{ pid = [int]$p.ProcessId; executable = [string]$p.ExecutablePath; commandLine = [string]$p.CommandLine; startedAt = $created } | ConvertTo-Json -Compress",
    ].join("; ");
    const result = await processOutput([
      "powershell.exe",
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      script,
    ]);
    if (result.code === 3) return null;
    if (result.code !== 0) {
      throw new Error(
        `Could not inspect Windows process ${pid}: ${result.stderr.trim()}`,
      );
    }
    return JSON.parse(result.stdout) as ObservedWindowsProcess;
  }

  async terminateTree(pid: number, force: boolean): Promise<void> {
    if (!Number.isSafeInteger(pid) || pid <= 0) {
      throw new Error("Refusing to terminate an invalid PID.");
    }
    const result = await processOutput([
      "taskkill.exe",
      "/PID",
      String(pid),
      "/T",
      ...(force ? ["/F"] : []),
    ]);
    if (result.code !== 0 && !/not found|not running/i.test(result.stderr)) {
      throw new Error(
        `Could not terminate Windows process ${pid}: ${result.stderr.trim()}`,
      );
    }
  }
}

export function normalizeWindowsPath(value: string): string {
  return resolve(value).replaceAll("\\", "/").toLowerCase();
}

function windowsTimestamp(value: string): number {
  const normalized = value.replace(
    /\.(\d{3})\d*(?=Z$)/,
    ".$1",
  );
  return Date.parse(normalized);
}

export function isSameWindowsProcess(
  expected: WindowsProcessIdentity,
  actual: ObservedWindowsProcess,
  toleranceMs = 15_000,
): boolean {
  if (expected.pid !== actual.pid) return false;
  if (
    normalizeWindowsPath(expected.executable) !==
    normalizeWindowsPath(actual.executable)
  ) {
    return false;
  }
  if (toleranceMs === 0) return expected.startedAt === actual.startedAt;
  const expectedStartedAt = windowsTimestamp(expected.startedAt);
  const actualStartedAt = windowsTimestamp(actual.startedAt);
  return (
    Number.isFinite(expectedStartedAt) &&
    Number.isFinite(actualStartedAt) &&
    Math.abs(expectedStartedAt - actualStartedAt) <= toleranceMs
  );
}
