import { describe, expect, test } from "bun:test";
import {
  getTagAtCursor,
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

  test("uses line breaks as tag boundaries without replacing them", () => {
    const multiline = "black hair\nlong hair\ncat ears";
    const cursor = multiline.indexOf("long") + "long".length;

    expect(getTagAtCursor(multiline, cursor)).toMatchObject({
      tag: "long hair",
      query: "long",
    });
    expect(replaceTagAtCursor(multiline, cursor, "short hair").value).toBe(
      "black hair\nshort hair\ncat ears",
    );
  });

  test("replaces only the tag containing the cursor", () => {
    const cursor = prompt.indexOf("cat ears") + "cat ears".length;

    expect(replaceTagAtCursor(prompt, cursor, "dog ears")).toEqual({
      value: "black hair, long hair, dog ears, fishbone hair",
      cursor: "black hair, long hair, dog ears".length,
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
