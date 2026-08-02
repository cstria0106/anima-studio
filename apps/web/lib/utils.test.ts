import { describe, expect, test } from "bun:test";
import {
  getPromptCommentRanges,
  isPositionInPromptComment,
  stripPromptComments,
} from "@anima/shared";
import {
  getTagAtCursor,
  isAutocompleteCommitKey,
  replaceTagAtCursor,
  tagComparisonKey,
} from "./utils";

describe("tag prompt editing", () => {
  const prompt = "black hair, long hair, cat ears, fishbone hair";

  test("finds the tag after the comma immediately before the cursor", () => {
    const cursor = prompt.indexOf("long hair") + "long hair,".length;

    expect(getTagAtCursor(prompt, cursor)).toMatchObject({
      tag: "cat ears",
      query: "",
    });
  });

  test("uses only text between the previous comma and the cursor as the query", () => {
    const edited = prompt.replace("cat ears", "blu cat ears");
    const cursor = edited.indexOf("blu") + "blu".length;

    expect(getTagAtCursor(edited, cursor)).toMatchObject({
      tag: "blu cat ears",
      query: "blu",
    });
  });

  test("ignores whitespace around the cursor's comma-delimited query", () => {
    const spaced = "black hair, long hair,   blu cat ears   , fishbone hair";
    const cursor = spaced.indexOf("blu") + "blu".length;

    expect(getTagAtCursor(spaced, cursor)).toMatchObject({
      tag: "blu cat ears",
      query: "blu",
    });
  });

  test("finds the tag when the cursor is immediately before its comma", () => {
    const cursor = prompt.indexOf("cat ears") + "cat ears".length;

    expect(getTagAtCursor(prompt, cursor)).toMatchObject({
      tag: "cat ears",
      query: "cat ears",
    });
  });

  test("keeps a trailing line comment outside the active tag", () => {
    const commented = "black hair, long ha // compare with short hair";
    const cursor = commented.indexOf("long ha") + "long ha".length;

    expect(getTagAtCursor(commented, cursor)).toMatchObject({
      tag: "long ha",
      query: "long ha",
    });
    expect(replaceTagAtCursor(commented, cursor, "long hair")).toEqual({
      value: "black hair, long hair // compare with short hair",
      cursor: "black hair, long hair".length,
    });
  });

  test("uses line breaks as tag boundaries and adds a comma before them", () => {
    const multiline = "black hair\nlong hair\ncat ears";
    const cursor = multiline.indexOf("long") + "long".length;

    expect(getTagAtCursor(multiline, cursor)).toMatchObject({
      tag: "long hair",
      query: "long",
    });
    expect(replaceTagAtCursor(multiline, cursor, "short hair")).toEqual({
      value: "black hair\nshort hair,\ncat ears",
      cursor: "black hair\nshort hair,".length,
    });
  });

  test("adds the missing comma when completing a tag before blank lines", () => {
    const multiline = [
      "1girl, solo, loli, vrc,",
      "red eyes, white pupils",
      "",
      "black hair, long hair, cat ears, animal ear fluff,",
      "",
      "serafuku,",
    ].join("\n");
    const cursor = multiline.indexOf("white pupils") + "white pupils".length;

    expect(replaceTagAtCursor(multiline, cursor, "white pupils")).toEqual({
      value: multiline.replace("white pupils\n", "white pupils,\n"),
      cursor: cursor + 1,
    });
  });

  test("replaces only the tag containing the cursor", () => {
    const cursor = prompt.indexOf("cat ears") + "cat ears".length;

    expect(replaceTagAtCursor(prompt, cursor, "dog ears")).toEqual({
      value: "black hair, long hair, dog ears, fishbone hair",
      cursor: "black hair, long hair, dog ears, ".length,
    });
  });

  test("moves past an existing comma when completing an unchanged tag", () => {
    const unchanged = "red eyes, white pupils, black hair";
    const cursor = unchanged.indexOf("white pupils") + "white pupils".length;

    expect(replaceTagAtCursor(unchanged, cursor, "white pupils")).toEqual({
      value: unchanged,
      cursor: "red eyes, white pupils, ".length,
    });
  });

  test("keeps the trailing comma convention when completing the final tag", () => {
    expect(replaceTagAtCursor("black hair, long ha", 19, "long hair")).toEqual({
      value: "black hair, long hair, ",
      cursor: 23,
    });
  });

  test("inserts an already escaped autocomplete tag without changing weights", () => {
    expect(
      replaceTagAtCursor("pho", 3, "phoebe \\(wuthering waves\\)").value,
    ).toBe("phoebe \\(wuthering waves\\), ");
  });

  test("compares escaped prompt tags with canonical autocomplete tags", () => {
    expect(tagComparisonKey("phoebe \\(wuthering waves\\)")).toBe(
      tagComparisonKey("phoebe (wuthering_waves)"),
    );
    expect(tagComparisonKey("score_7")).toBe("score_7");
  });
});

describe("autocomplete keyboard handling", () => {
  test("commits Enter and Tab outside text composition", () => {
    expect([
      isAutocompleteCommitKey("Enter", false),
      isAutocompleteCommitKey("Tab", false),
    ]).toEqual([true, true]);
  });

  test("does not commit Enter while an IME composition is active", () => {
    expect(isAutocompleteCommitKey("Enter", true)).toBeFalse();
  });

  test("does not commit unrelated keys", () => {
    expect(isAutocompleteCommitKey("ArrowDown", false)).toBeFalse();
  });
});

describe("prompt line comments", () => {
  const prompt = "red eyes, // experiment\nlong hair // optional";

  test("finds comment text without consuming line breaks", () => {
    expect(getPromptCommentRanges(prompt)).toEqual([
      {
        start: prompt.indexOf("// experiment"),
        end: prompt.indexOf("// experiment") + "// experiment".length,
      },
      {
        start: prompt.indexOf("// optional"),
        end: prompt.length,
      },
    ]);
  });

  test("removes comments while preserving line structure", () => {
    expect(stripPromptComments(prompt)).toBe("red eyes, \nlong hair ");
  });

  test("recognizes cursor positions inside comments only", () => {
    const commentStart = prompt.indexOf("// experiment");
    expect(isPositionInPromptComment(prompt, commentStart)).toBeFalse();
    expect(isPositionInPromptComment(prompt, commentStart + 2)).toBeTrue();
    expect(
      isPositionInPromptComment(prompt, prompt.indexOf("long hair")),
    ).toBeFalse();
  });
});
