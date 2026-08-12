import { describe, expect, it } from "vitest";
import {
  MAX_EDITOR_FONT_SIZE,
  MIN_EDITOR_FONT_SIZE,
  clampEditorFontSize,
  getEditorZoomDelta,
} from "./editor-zoom";

describe("editor zoom", () => {
  it("recognizes Ctrl plus across main and numeric keyboard layouts", () => {
    expect(
      getEditorZoomDelta({ altKey: false, code: "Semicolon", ctrlKey: true, key: "+", metaKey: false }),
    ).toBe(1);
    expect(
      getEditorZoomDelta({ altKey: false, code: "Equal", ctrlKey: true, key: "=", metaKey: false }),
    ).toBe(1);
    expect(
      getEditorZoomDelta({ altKey: false, code: "NumpadAdd", ctrlKey: true, key: "+", metaKey: false }),
    ).toBe(1);
  });

  it("recognizes Ctrl minus across main and numeric keyboard layouts", () => {
    expect(
      getEditorZoomDelta({ altKey: false, code: "Minus", ctrlKey: true, key: "-", metaKey: false }),
    ).toBe(-1);
    expect(
      getEditorZoomDelta({
        altKey: false,
        code: "NumpadSubtract",
        ctrlKey: true,
        key: "-",
        metaKey: false,
      }),
    ).toBe(-1);
  });

  it("does not consume unrelated or Alt-modified shortcuts", () => {
    expect(
      getEditorZoomDelta({ altKey: false, code: "Equal", ctrlKey: false, key: "=", metaKey: false }),
    ).toBe(0);
    expect(
      getEditorZoomDelta({ altKey: true, code: "Equal", ctrlKey: true, key: "+", metaKey: false }),
    ).toBe(0);
  });

  it("clamps the editor font size to readable bounds", () => {
    expect(clampEditorFontSize(MIN_EDITOR_FONT_SIZE - 1)).toBe(MIN_EDITOR_FONT_SIZE);
    expect(clampEditorFontSize(MAX_EDITOR_FONT_SIZE + 1)).toBe(MAX_EDITOR_FONT_SIZE);
    expect(clampEditorFontSize(17)).toBe(17);
  });
});
