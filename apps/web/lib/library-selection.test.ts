import { describe, expect, test } from "bun:test";
import {
  selectLibraryContextTarget,
  selectLibraryItem,
} from "./library-selection";

const ordered = ["a", "b", "c", "d", "e"];

describe("library selection", () => {
  test("plain click replaces the selection and establishes the anchor", () => {
    expect(
      selectLibraryItem(
        { selectedIds: ["a", "b"], anchorId: "a" },
        ordered,
        "d",
      ),
    ).toEqual({ selectedIds: ["d"], anchorId: "d" });
  });

  test("control click toggles one image", () => {
    const added = selectLibraryItem(
      { selectedIds: ["a"], anchorId: "a" },
      ordered,
      "c",
      { ctrl: true },
    );
    expect(added).toEqual({ selectedIds: ["a", "c"], anchorId: "c" });
    expect(selectLibraryItem(added, ordered, "a", { ctrl: true })).toEqual({
      selectedIds: ["c"],
      anchorId: "a",
    });
  });

  test("shift selects an ordered range and control-shift adds it", () => {
    expect(
      selectLibraryItem(
        { selectedIds: ["b"], anchorId: "b" },
        ordered,
        "d",
        { shift: true },
      ).selectedIds,
    ).toEqual(["b", "c", "d"]);
    expect(
      selectLibraryItem(
        { selectedIds: ["a"], anchorId: "c" },
        ordered,
        "e",
        { ctrl: true, shift: true },
      ).selectedIds,
    ).toEqual(["a", "c", "d", "e"]);
  });

  test("context click preserves a selected group and replaces an unrelated target", () => {
    const group = { selectedIds: ["b", "c"], anchorId: "b" };
    expect(selectLibraryContextTarget(group, "c")).toBe(group);
    expect(selectLibraryContextTarget(group, "e")).toEqual({
      selectedIds: ["e"],
      anchorId: "e",
    });
  });
});
