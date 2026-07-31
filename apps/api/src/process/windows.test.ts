import { describe, expect, test } from "bun:test";
import { isSameWindowsProcess } from "./windows";

describe("Windows process identity", () => {
  test("accepts CIM seven-digit timestamps for runtime ownership", () => {
    expect(isSameWindowsProcess(
      {
        pid: 42,
        executable: "C:\\AnimaStudio\\python.exe",
        startedAt: "2026-08-01T00:00:00.638Z",
      },
      {
        pid: 42,
        executable: "C:\\AnimaStudio\\python.exe",
        startedAt: "2026-08-01T00:00:00.6386040Z",
        commandLine: "python.exe",
      },
    )).toBeTrue();
  });

  test("requires the exact CIM start identifier for app instances", () => {
    const expected = {
      pid: 42,
      executable: "C:\\AnimaStudio\\AnimaStudio.exe",
      startedAt: "2026-08-01T00:00:00.6386040Z",
    };
    expect(isSameWindowsProcess(expected, { ...expected, commandLine: "" }, 0)).toBeTrue();
    expect(isSameWindowsProcess(expected, {
      ...expected,
      commandLine: "",
      startedAt: "2026-08-01T00:00:00.6386050Z",
    }, 0)).toBeFalse();
  });
});
