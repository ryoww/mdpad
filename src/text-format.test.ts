import { describe, expect, it } from "vitest";
import {
  detectLineEnding,
  formatCharacterCount,
  normalizeLineEndings,
  splitEditorLines,
} from "./text-format";

describe("text formatting", () => {
  it("detects CRLF documents", () => {
    expect(detectLineEnding("first\r\nsecond\r\n")).toBe("CRLF");
    expect(detectLineEnding("first\nsecond\n")).toBe("LF");
  });

  it("normalizes both Windows and legacy Mac line endings", () => {
    expect(normalizeLineEndings("a\r\nb\rc\n")).toBe("a\nb\nc\n");
  });

  it("splits normalized text independently of the previous document line ending", () => {
    expect(splitEditorLines("first\r\nsecond\r\n")).toEqual(["first", "second", ""]);
    expect(splitEditorLines("next\nfile")).toEqual(["next", "file"]);
  });

  it("formats large character counts for the status bar", () => {
    expect(formatCharacterCount(12345)).toBe("12,345 文字");
  });
});
