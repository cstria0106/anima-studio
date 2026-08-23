import { describe, expect, test } from "bun:test";
import { parsePortableArguments } from "./arguments";

describe("portable arguments", () => {
  test("uses the loopback host and automatic port selection by default", () => {
    expect(parsePortableArguments([])).toEqual({
      host: "127.0.0.1",
      port: undefined,
      noBrowser: false,
      version: false,
    });
  });

  test("accepts spaced and equals host and port options in any order", () => {
    expect(
      parsePortableArguments([
        "--port",
        "9000",
        "--no-browser",
        "--host=192.168.0.20",
        "--version",
      ]),
    ).toEqual({
      host: "192.168.0.20",
      port: 9000,
      noBrowser: true,
      version: true,
    });
    expect(parsePortableArguments(["--port=65535", "--host", "0.0.0.0"]))
      .toMatchObject({ host: "0.0.0.0", port: 65_535 });
  });

  for (const [args, message] of [
    [["--host", "localhost"], /Invalid IPv4 address/],
    [["--host", "::1"], /Invalid IPv4 address/],
    [["--host"], /--host requires a value/],
    [["--port=0"], /Invalid TCP port/],
    [["--port", "65536"], /Invalid TCP port/],
    [["--port", "8.5"], /Invalid TCP port/],
    [["--port"], /--port requires a value/],
    [["--host=127.0.0.1", "--host", "127.0.0.2"], /Duplicate option: --host/],
    [["--port=8787", "--port", "9000"], /Duplicate option: --port/],
    [["--unknown"], /Unknown option/],
  ] as const) {
    test(`rejects invalid arguments: ${args.join(" ")}`, () => {
      expect(() => parsePortableArguments([...args])).toThrow(message);
    });
  }
});
