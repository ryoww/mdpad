import { describe, expect, it } from "vitest";
import { DocumentSession } from "./document-session";

describe("DocumentSession", () => {
  it("starts as a clean untitled Markdown document", () => {
    const session = new DocumentSession();

    expect(session.displayName).toBe("無題.md");
    expect(session.displayPath).toBe("未保存の新規メモ");
    expect(session.windowTitle).toBe("無題.md — mdpad");
    expect(session.kind).toBe("Markdown");
    expect(session.dirty).toBe(false);
  });

  it("extracts a file name from Windows paths", () => {
    const session = new DocumentSession();

    session.load("C:\\notes\\release.md");

    expect(session.displayName).toBe("release.md");
    expect(session.displayPath).toBe("C:\\notes\\release.md");
    expect(session.windowTitle).toBe("C:\\notes\\release.md — mdpad");
  });

  it("recognizes text files without affecting Markdown defaults", () => {
    const session = new DocumentSession();

    session.load("C:/notes/ideas.TXT");
    expect(session.kind).toBe("Text");

    session.load("C:/notes/ideas.markdown");
    expect(session.kind).toBe("Markdown");
  });

  it("returns to a clean state after saving", () => {
    const session = new DocumentSession();

    session.setDirty(true);
    session.markSaved("C:\\notes\\saved.md");

    expect(session.dirty).toBe(false);
    expect(session.displayName).toBe("saved.md");
  });

  it("marks an unsaved full path in the window title", () => {
    const session = new DocumentSession();
    session.load("C:\\notes\\draft.md");

    session.setDirty(true);

    expect(session.windowTitle).toBe("● C:\\notes\\draft.md — mdpad");
  });
});
