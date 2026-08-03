import { describe, expect, test } from "bun:test";
import {
  escapeDanbooruTagForPrompt,
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
    expect(normalizeDanbooruTag("=_=")).toBe("=_=");
  });

  test("normalizes prompt escapes while preserving Anima score tags", () => {
    expect(normalizeDanbooruTag("phoebe_\\(wuthering_waves\\)")).toBe(
      "phoebe (wuthering waves)",
    );
    expect(normalizeDanbooruTag("score_7")).toBe("score_7");
  });

  test("escapes literal tag parentheses for ComfyUI prompt insertion", () => {
    expect(escapeDanbooruTagForPrompt("phoebe_(wuthering_waves)")).toBe(
      "phoebe \\(wuthering waves\\)",
    );
  });
});
