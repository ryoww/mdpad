// @vitest-environment jsdom

import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppController } from "./app-controller";
import type { MarkdownEditor } from "./editor";
import type { FileGateway } from "./file-gateway";

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
      <span id="dirty-dot"></span>
      <button type="button" data-action="new"></button>
      <button type="button" data-action="open"></button>
      <button id="save-button" type="button" data-action="save"></button>
      <button type="button" data-action="save-as"></button>
      <button type="button" data-action="find"></button>
      <div id="editor"></div>
      <span id="save-status"><span></span> 保存済み</span>
      <span id="runtime-status"></span>
      <span id="character-status"></span>
      <span id="cursor-status"></span>
      <span id="line-ending-status"></span>
      <span id="document-kind-status"></span>
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
      runtimeLabel: "Tauri Desktop",
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
  });
});
