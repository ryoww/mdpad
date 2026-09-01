// @vitest-environment jsdom

import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppController } from "./app-controller";
import type { MarkdownEditor } from "./editor";
import type { FileGateway } from "./file-gateway";
import { PREVIEW_CHARACTER_LIMIT } from "./markdown-preview";

const controllers: AppController[] = [];

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

function createAppRoot(): HTMLElement {
  document.body.innerHTML = `
    <div id="app">
      <span id="document-name"></span>
      <span id="document-path"></span>
      <div data-menu-root="file">
        <button type="button" data-menu-trigger="file" aria-controls="file-menu" aria-expanded="false">ファイル</button>
        <div id="file-menu" hidden>
          <button type="button" data-action="new"></button>
          <button type="button" data-action="open"></button>
          <button id="save-button" type="button" data-action="save"></button>
          <button type="button" data-action="save-as"></button>
        </div>
      </div>
      <div data-menu-root="edit">
        <button type="button" data-menu-trigger="edit" aria-controls="edit-menu" aria-expanded="false">編集</button>
        <div id="edit-menu" hidden>
          <button type="button" data-action="undo"></button>
          <button type="button" data-action="redo"></button>
          <button type="button" data-action="find"></button>
        </div>
      </div>
      <div data-menu-root="view">
        <button type="button" data-menu-trigger="view" aria-controls="view-menu" aria-expanded="false">表示</button>
        <div id="view-menu" hidden>
          <button id="preview-button" type="button" data-action="preview" aria-pressed="false"><span>プレビュー</span></button>
          <button id="line-wrap-button" type="button" data-action="line-wrap" aria-pressed="false"><span>行を折り返す</span></button>
          <button type="button" data-action="zoom-in"></button>
          <button type="button" data-action="zoom-out"></button>
        </div>
      </div>
      <section id="editor-region"><div id="editor"></div></section>
      <section id="preview-region" hidden>
        <article id="preview" tabindex="0"></article>
        <div id="preview-empty" hidden><strong></strong><span></span></div>
      </section>
      <span id="save-status" hidden>未保存</span>
      <span id="character-status" hidden></span>
      <span id="cursor-status"></span>
      <span id="line-ending-status" hidden></span>
      <span id="document-kind-status" hidden></span>
      <span id="line-wrap-status" hidden>折り返し</span>
      <div id="toast"></div>
    </div>
  `;
  return document.querySelector<HTMLElement>("#app")!;
}

function destroyController(controller: AppController): void {
  const editor = (controller as unknown as { editor: MarkdownEditor }).editor;
  const view = (editor as unknown as { view: EditorView }).view;
  view.destroy();
}

afterEach(() => {
  for (const controller of controllers) {
    destroyController(controller);
  }
  controllers.length = 0;
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("AppController startup", () => {
  it("keeps editing disabled while the native close guard is registering", async () => {
    const closeGuardRegistration = createDeferred<number>();
    const invoke = vi.fn((command: string) => {
      if (command === "plugin:event|listen") {
        return closeGuardRegistration.promise;
      }
      return Promise.resolve();
    });
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {
        invoke,
        metadata: { currentWindow: { label: "main" } },
        transformCallback: vi.fn(() => 1),
        unregisterCallback: vi.fn(),
      },
    });
    Object.defineProperty(Range.prototype, "getClientRects", {
      configurable: true,
      value: () => [],
    });
    Object.defineProperty(Range.prototype, "getBoundingClientRect", {
      configurable: true,
      value: () => new DOMRect(),
    });
    const openStartup = vi.fn(async () => ({
      content: "startup content",
      path: "C:\\notes\\startup.md",
    }));
    const files: FileGateway = {
      confirmDiscard: vi.fn(async () => true),
      open: vi.fn(async () => null),
      openStartup,
      save: vi.fn(async () => null),
    };
    const root = createAppRoot();
    const controller = new AppController(root, files);
    controllers.push(controller);

    const startup = controller.start();

    expect(root.dataset.busy).toBe("true");
    expect(root.querySelector<HTMLButtonElement>("#save-button")!.disabled).toBe(true);
    expect(root.querySelector<HTMLElement>(".cm-content")!.getAttribute("contenteditable")).toBe(
      "false",
    );
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("plugin:event|listen", expect.anything(), undefined),
    );
    expect(openStartup).not.toHaveBeenCalled();

    closeGuardRegistration.resolve(1);
    await startup;

    expect(openStartup).toHaveBeenCalledOnce();
    expect(root.dataset.busy).toBe("false");
    expect(root.querySelector<HTMLElement>(".cm-content")!.getAttribute("contenteditable")).toBe(
      "true",
    );
    expect(root.querySelector<HTMLElement>("#document-path")!.textContent).toBe(
      "C:\\notes\\startup.md",
    );
    expect(root.querySelector<HTMLElement>(".cm-content")!.textContent).toBe("startup content");
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        "plugin:window|set_title",
        { label: "main", value: "C:\\notes\\startup.md — mdpad" },
        undefined,
      ),
    );
  });

  it("opens one top menu at a time and closes it with Escape", async () => {
    const files: FileGateway = {
      confirmDiscard: vi.fn(async () => true),
      open: vi.fn(async () => null),
      openStartup: vi.fn(async () => null),
      save: vi.fn(async () => null),
    };
    const root = createAppRoot();
    const controller = new AppController(root, files);
    controllers.push(controller);
    await controller.start();
    const fileTrigger = root.querySelector<HTMLButtonElement>('[data-menu-trigger="file"]')!;
    const editTrigger = root.querySelector<HTMLButtonElement>('[data-menu-trigger="edit"]')!;
    const fileMenu = root.querySelector<HTMLElement>("#file-menu")!;
    const editMenu = root.querySelector<HTMLElement>("#edit-menu")!;

    fileTrigger.click();
    expect(fileTrigger.getAttribute("aria-expanded")).toBe("true");
    expect(fileMenu.hidden).toBe(false);

    editTrigger.click();
    expect(fileTrigger.getAttribute("aria-expanded")).toBe("false");
    expect(fileMenu.hidden).toBe(true);
    expect(editTrigger.getAttribute("aria-expanded")).toBe("true");
    expect(editMenu.hidden).toBe(false);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(editTrigger.getAttribute("aria-expanded")).toBe("false");
    expect(editMenu.hidden).toBe(true);
    expect(document.activeElement).toBe(editTrigger);

    const editor = (controller as unknown as { editor: MarkdownEditor }).editor;
    const view = (editor as unknown as { view: EditorView }).view;
    view.dispatch({ changes: { from: 0, insert: "undo from menu" }, userEvent: "input.type" });
    window.dispatchEvent(
      new KeyboardEvent("keydown", { cancelable: true, ctrlKey: true, key: "z" }),
    );
    expect(editor.getValue()).toBe("");
    window.dispatchEvent(
      new KeyboardEvent("keydown", { cancelable: true, ctrlKey: true, key: "y" }),
    );
    expect(editor.getValue()).toBe("undo from menu");

    const undo = vi.spyOn(editor, "undo");
    root.querySelector<HTMLButtonElement>('[data-action="find"]')!.click();
    const searchInput = root.querySelector<HTMLInputElement>(".cm-panel.cm-search input")!;
    searchInput.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        key: "z",
      }),
    );
    expect(undo).not.toHaveBeenCalled();
  });

  it("switches between horizontal scrolling and line wrapping", async () => {
    const files: FileGateway = {
      confirmDiscard: vi.fn(async () => true),
      open: vi.fn(async () => null),
      openStartup: vi.fn(async () => null),
      save: vi.fn(async () => null),
    };
    const root = createAppRoot();
    const controller = new AppController(root, files);
    controllers.push(controller);
    await controller.start();
    const editor = (controller as unknown as { editor: MarkdownEditor }).editor;
    const button = root.querySelector<HTMLButtonElement>("#line-wrap-button")!;
    const status = root.querySelector<HTMLElement>("#line-wrap-status")!;

    expect(editor.isLineWrapping()).toBe(false);
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(status.hidden).toBe(true);

    button.click();
    expect(editor.isLineWrapping()).toBe(true);
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(button.classList.contains("menu-item--active")).toBe(true);
    expect(status.hidden).toBe(false);
    expect(status.textContent).toBe("折り返し");

    window.dispatchEvent(
      new KeyboardEvent("keydown", { altKey: true, cancelable: true, key: "z" }),
    );
    expect(editor.isLineWrapping()).toBe(false);
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(status.hidden).toBe(true);
  });

  it("switches to a rendered and sanitized Markdown preview", async () => {
    const files: FileGateway = {
      confirmDiscard: vi.fn(async () => true),
      open: vi.fn(async () => null),
      openStartup: vi.fn(async () => ({
        content: '# Preview\n\n**bold**<script>alert("unsafe")</script>',
        path: "preview.md",
      })),
      save: vi.fn(async () => null),
    };
    const root = createAppRoot();
    const controller = new AppController(root, files);
    controllers.push(controller);
    await controller.start();

    root.querySelector<HTMLButtonElement>("#preview-button")!.click();

    expect(root.querySelector<HTMLElement>("#editor-region")!.hidden).toBe(true);
    expect(root.querySelector<HTMLElement>("#preview-region")!.hidden).toBe(false);
    expect(root.querySelector<HTMLElement>("#preview")!.innerHTML).toContain(
      "<h1>Preview</h1>",
    );
    expect(root.querySelector<HTMLElement>("#preview")!.innerHTML).toContain(
      "<strong>bold</strong>",
    );
    expect(root.querySelector<HTMLElement>("#preview")!.innerHTML).not.toContain("<script");
    expect(root.querySelector<HTMLButtonElement>("#preview-button")!.getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(root.querySelector<HTMLButtonElement>("#preview-button")!.textContent).toBe(
      "プレビュー",
    );
  });

  it("previews text documents without interpreting Markdown", async () => {
    const files: FileGateway = {
      confirmDiscard: vi.fn(async () => true),
      open: vi.fn(async () => null),
      openStartup: vi.fn(async () => ({ content: "# Plain text", path: "notes.txt" })),
      save: vi.fn(async () => null),
    };
    const root = createAppRoot();
    const controller = new AppController(root, files);
    controllers.push(controller);
    await controller.start();

    root.querySelector<HTMLButtonElement>("#preview-button")!.click();

    expect(root.querySelector<HTMLElement>("#preview")!.innerHTML).not.toContain("<h1>");
    expect(root.querySelector<HTMLElement>(".plain-text-preview")!.textContent).toBe(
      "# Plain text",
    );
  });

  it("does not synchronously render oversized documents", async () => {
    const files: FileGateway = {
      confirmDiscard: vi.fn(async () => true),
      open: vi.fn(async () => null),
      openStartup: vi.fn(async () => ({
        content: "x".repeat(PREVIEW_CHARACTER_LIMIT + 1),
        path: "large.md",
      })),
      save: vi.fn(async () => null),
    };
    const root = createAppRoot();
    const controller = new AppController(root, files);
    controllers.push(controller);
    await controller.start();
    const editor = (controller as unknown as { editor: MarkdownEditor }).editor;
    const getValue = vi.spyOn(editor, "getValue");

    root.querySelector<HTMLButtonElement>("#preview-button")!.click();

    expect(getValue).not.toHaveBeenCalled();
    expect(root.querySelector<HTMLElement>("#preview")!.childElementCount).toBe(0);
    expect(root.querySelector<HTMLElement>("#preview-empty")!.hidden).toBe(false);
    expect(root.querySelector<HTMLElement>("#preview-empty strong")!.textContent).toContain(
      "サイズ",
    );
  });

  it("restores focus after saving only once the editor accepts input again", async () => {
    const files: FileGateway = {
      confirmDiscard: vi.fn(async () => true),
      open: vi.fn(async () => null),
      openStartup: vi.fn(async () => ({ content: "# 設計メモ", path: "C:\\notes\\memo.md" })),
      save: vi.fn(async () => "C:\\notes\\memo.md"),
    };
    const root = createAppRoot();
    const controller = new AppController(root, files);
    controllers.push(controller);
    await controller.start();
    const content = root.querySelector<HTMLElement>(".cm-content")!;

    // jsdom は contenteditable="false" の要素にも focus() を通すため、
    // activeElement を見ても実ブラウザの失敗を再現できない。ブラウザが
    // フォーカス要求を捨てる条件そのもの、つまり要求した時点で入力を
    // 受け付けられる状態だったかを記録して確かめる。
    const editableWhenFocused: (string | null)[] = [];
    vi.spyOn(content, "focus").mockImplementation(() => {
      editableWhenFocused.push(content.getAttribute("contenteditable"));
    });

    root.querySelector<HTMLButtonElement>('[data-action="save"]')!.click();

    await vi.waitFor(() => expect(files.save).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(editableWhenFocused.length).toBeGreaterThan(0));
    expect(editableWhenFocused).not.toContain("false");
  });

  it("does not pull focus into the hidden editor when saving from the preview", async () => {
    const files: FileGateway = {
      confirmDiscard: vi.fn(async () => true),
      open: vi.fn(async () => null),
      openStartup: vi.fn(async () => ({ content: "# 設計メモ", path: "C:\\notes\\memo.md" })),
      save: vi.fn(async () => "C:\\notes\\memo.md"),
    };
    const root = createAppRoot();
    const controller = new AppController(root, files);
    controllers.push(controller);
    await controller.start();
    const content = root.querySelector<HTMLElement>(".cm-content")!;
    const focusRequests = vi.spyOn(content, "focus").mockImplementation(() => undefined);
    root.querySelector<HTMLButtonElement>("#preview-button")!.click();
    focusRequests.mockClear();

    root.querySelector<HTMLButtonElement>('[data-action="save"]')!.click();

    await vi.waitFor(() => expect(files.save).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(root.dataset.busy).toBe("false"));
    expect(focusRequests).not.toHaveBeenCalled();
  });

  it("re-renders when Save As changes the document between Markdown and text", async () => {
    const files: FileGateway = {
      confirmDiscard: vi.fn(async () => true),
      open: vi.fn(async () => null),
      openStartup: vi.fn(async () => ({ content: "# Same content", path: "notes.md" })),
      save: vi.fn(async () => "notes.txt"),
    };
    const root = createAppRoot();
    const controller = new AppController(root, files);
    controllers.push(controller);
    await controller.start();
    root.querySelector<HTMLButtonElement>("#preview-button")!.click();
    expect(root.querySelector<HTMLElement>("#preview h1")!.textContent).toBe("Same content");

    root.querySelector<HTMLButtonElement>('[data-action="save-as"]')!.click();

    await vi.waitFor(() =>
      expect(root.querySelector<HTMLElement>(".plain-text-preview")?.textContent).toBe(
        "# Same content",
      ),
    );
    expect(root.querySelector<HTMLElement>("#preview h1")).toBeNull();
  });
});
