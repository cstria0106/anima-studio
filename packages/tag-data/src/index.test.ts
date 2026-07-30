import { describe, expect, test } from "bun:test";
import {
  normalizeDanbooruTag,
  parseCsvRow,
  parseDanbooruCooccurrenceRow,
  parseDanbooruTagRow,
} from "./index";

describe("Danbooru CSV parsing", () => {
  test("normalizes canonical tags and retains searchable aliases", () => {
    const fields = parseCsvRow(
      'red_eyes,0,2000000,"red_eye,scarlet_eyes,eyes,_red"',
    );

    expect(parseDanbooruTagRow(fields)).toEqual({
      tag: "red eyes",
      category: "general",
      count: 2_000_000,
      description: "",
      aliases: ["red eye", "scarlet eyes", "eyes", "red"],
    });
  });

  test("maps Danbooru categories and numeric cooccurrence counts", () => {
    expect(parseDanbooruTagRow(["some_artist", "1", "25", ""])?.category).toBe(
      "artist",
    );
    expect(
      parseDanbooruTagRow(["some_character", "4", "25", ""])?.category,
    ).toBe("character");
    expect(
      parseDanbooruCooccurrenceRow(["red_eyes", "white_pupils", "1234.9"]),
    ).toEqual({
      tag: "red eyes",
      relatedTag: "white pupils",
      count: 1_234,
    });
  });

  test("normalizes underscores without changing punctuation", () => {
    expect(normalizeDanbooruTag("  koikatsu_(medium)  ")).toBe(
      "koikatsu (medium)",
    );
  });
});
