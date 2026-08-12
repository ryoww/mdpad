// @vitest-environment jsdom

import { undo, undoDepth } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { MarkdownEditor } from "./editor";

const editors: MarkdownEditor[] = [];

function internalView(editor: MarkdownEditor): EditorView {
  return (editor as unknown as { view: EditorView }).view;
}

afterEach(() => {
  for (const editor of editors) {
    internalView(editor).destroy();
  }
  editors.length = 0;
  document.body.replaceChildren();
});

describe("MarkdownEditor document replacement", () => {
  it("uses the requested editor font and an internal scroll container", () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const editor = new MarkdownEditor(parent, () => undefined);
    editors.push(editor);
    const scroller = parent.querySelector<HTMLElement>(".cm-scroller");

    expect(scroller).not.toBeNull();
    expect(getComputedStyle(scroller!).overflow).toBe("auto");
    expect(getComputedStyle(scroller!).fontFamily).toContain("PlemolJP Console NF");
    expect(getComputedStyle(internalView(editor).contentDOM).whiteSpace).toBe("pre");
  });

  it("changes and clamps the editor font size", () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const editor = new MarkdownEditor(parent, () => undefined);
    editors.push(editor);

    expect(editor.getFontSize()).toBe(15);
    expect(internalView(editor).dom.style.getPropertyValue("--mdpad-editor-font-size")).toBe("15px");
    expect(editor.adjustFontSize(1)).toBe(16);
    expect(internalView(editor).dom.style.getPropertyValue("--mdpad-editor-font-size")).toBe("16px");
    editor.setContent("new document");
    expect(editor.getFontSize()).toBe(16);
    expect(internalView(editor).dom.style.getPropertyValue("--mdpad-editor-font-size")).toBe("16px");
    expect(editor.adjustFontSize(100)).toBe(28);
    expect(editor.adjustFontSize(-100)).toBe(10);
  });

  it("keeps CRLF output while parsing every loaded document into real lines", () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const editor = new MarkdownEditor(parent, () => undefined);
    editors.push(editor);

    editor.setContent("first\r\nsecond\r\n");
    expect(internalView(editor).state.doc.lines).toBe(3);
    expect(editor.getValue()).toBe("first\r\nsecond\r\n");

    editor.setContent("next\nfile");
    expect(internalView(editor).state.doc.lines).toBe(2);
    expect(editor.getValue()).toBe("next\nfile");
  });

  it("clears undo history when switching documents", () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const editor = new MarkdownEditor(parent, () => undefined);
    editors.push(editor);
    const view = internalView(editor);

    view.dispatch({ changes: { from: 0, insert: "old document" }, userEvent: "input.type" });
    expect(undoDepth(view.state)).toBe(1);

    editor.setContent("new document");

    expect(undoDepth(view.state)).toBe(0);
    expect(undo(view)).toBe(false);
    expect(editor.getValue()).toBe("new document");
  });

  it("keeps edits dirty when they occur after a save snapshot was captured", () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const snapshots: Array<{ dirty: boolean }> = [];
    const editor = new MarkdownEditor(parent, (snapshot) => snapshots.push(snapshot));
    editors.push(editor);
    editor.setContent("saved text");
    const saveSnapshot = editor.createSaveSnapshot();

    internalView(editor).dispatch({
      changes: { from: editor.getValue().length, insert: " and a later edit" },
      userEvent: "input.type",
    });
    editor.markSaved(saveSnapshot);

    expect(snapshots.at(-1)?.dirty).toBe(true);
  });

  it("prevents edits while a file operation is active", () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const editor = new MarkdownEditor(parent, () => undefined);
    editors.push(editor);
    const view = internalView(editor);

    editor.setReadOnly(true);
    expect(view.state.facet(EditorState.readOnly)).toBe(true);
    expect(view.state.facet(EditorView.editable)).toBe(false);

    editor.setReadOnly(false);
    expect(view.state.facet(EditorState.readOnly)).toBe(false);
    expect(view.state.facet(EditorView.editable)).toBe(true);
  });
});
