import { shouldPreventWindowClose } from "./close-guard";
import { DocumentSession } from "./document-session";
import { MarkdownEditor, type EditorSnapshot } from "./editor";
import { getEditorZoomDelta } from "./editor-zoom";
import type { FileGateway } from "./file-gateway";
import { isTauriRuntime } from "./file-gateway";
import { formatCharacterCount } from "./text-format";

type ActionName = "find" | "new" | "open" | "save" | "save-as";

export class AppController {
  private readonly documentSession = new DocumentSession();
  private readonly editor: MarkdownEditor;
  private snapshot: EditorSnapshot = {
    characterCount: 0,
    column: 1,
    dirty: false,
    line: 1,
    lineEnding: "LF",
  };
  private busy = false;
  private lastWindowTitle = "";
  private renderFrame = 0;
  private toastTimer = 0;
  private windowTitleUpdate = Promise.resolve();

  constructor(
    private readonly root: HTMLElement,
    private readonly files: FileGateway,
  ) {
    const editorHost = this.element<HTMLElement>("#editor");
    this.editor = new MarkdownEditor(editorHost, (snapshot) => {
      this.snapshot = snapshot;
      this.documentSession.setDirty(snapshot.dirty);
      this.scheduleRender();
    });
  }

  async start(): Promise<void> {
    this.bindCommands();
    this.element<HTMLElement>("#runtime-status").textContent = this.files.runtimeLabel;
    this.render();
    await this.withBusyState(async () => {
      await this.registerCloseGuard();
      await this.loadStartupDocument();
    });
    this.editor.focus();
  }

  private async loadStartupDocument(): Promise<void> {
    const opened = await this.files.openStartup();
    if (!opened) {
      return;
    }

    this.loadDocument(opened);
  }

  private bindCommands(): void {
    this.root.querySelectorAll<HTMLButtonElement>("[data-action]").forEach((button) => {
      button.addEventListener("click", () => {
        const action = button.dataset.action as ActionName;
        void this.runAction(action);
      });
    });

    window.addEventListener(
      "keydown",
      (event) => {
        const zoomDelta = getEditorZoomDelta(event);
        if (zoomDelta !== 0) {
          event.preventDefault();
          event.stopPropagation();
          const fontSize = this.editor.adjustFontSize(zoomDelta);
          this.showToast(`文字サイズ ${fontSize}px`);
          return;
        }

        if (!event.ctrlKey || event.altKey) {
          return;
        }

        const key = event.key.toLocaleLowerCase();
        let action: ActionName | null = null;
        if (key === "n") action = "new";
        if (key === "o") action = "open";
        if (key === "s") action = event.shiftKey ? "save-as" : "save";
        if (key === "f") action = "find";

        if (action) {
          event.preventDefault();
          event.stopPropagation();
          void this.runAction(action);
        }
      },
      { capture: true },
    );

    window.addEventListener("beforeunload", (event) => {
      if (!isTauriRuntime() && this.documentSession.dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    });
  }

  private async runAction(action: ActionName): Promise<void> {
    if (this.busy && action !== "find") {
      return;
    }

    if (action === "find") {
      this.editor.openSearch();
      return;
    }

    if (action === "new") await this.newDocument();
    if (action === "open") await this.openDocument();
    if (action === "save") await this.saveDocument(false);
    if (action === "save-as") await this.saveDocument(true);
  }

  private async newDocument(): Promise<void> {
    if (!(await this.canReplaceDocument())) {
      return;
    }

    this.documentSession.reset();
    this.editor.setContent("");
    this.render();
    this.editor.focus();
    this.showToast("新しいメモを作成しました");
  }

  private async openDocument(): Promise<void> {
    if (!(await this.canReplaceDocument())) {
      return;
    }

    await this.withBusyState(async () => {
      const opened = await this.files.open();
      if (!opened) {
        return;
      }

      this.loadDocument(opened);
      this.editor.focus();
    });
  }

  private loadDocument(opened: { content: string; path: string }): void {
    this.documentSession.load(opened.path);
    this.editor.setContent(opened.content);
    this.render();
    this.showToast(`${this.documentSession.displayName} を開きました`);
  }

  private async saveDocument(forceNewPath: boolean): Promise<boolean> {
    let saved = false;
    await this.withBusyState(async () => {
      const editorSnapshot = this.editor.createSaveSnapshot();
      const path = await this.files.save({
        content: editorSnapshot.content,
        currentPath: this.documentSession.path,
        forceNewPath,
        suggestedName: this.documentSession.displayName,
      });

      if (!path) {
        return;
      }

      this.documentSession.markSaved(path);
      this.editor.markSaved(editorSnapshot);
      this.render();
      this.editor.focus();
      this.showToast(`${this.documentSession.displayName} を保存しました`);
      saved = true;
    });
    return saved;
  }

  private async canReplaceDocument(): Promise<boolean> {
    if (!this.documentSession.dirty) {
      return true;
    }

    return this.files.confirmDiscard(
      `${this.documentSession.displayName} には未保存の変更があります。変更を破棄しますか？`,
    );
  }

  private async withBusyState(operation: () => Promise<void>): Promise<void> {
    this.setBusy(true);
    try {
      await operation();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(error);
      this.showToast(`操作を完了できませんでした: ${message}`, true);
    } finally {
      this.setBusy(false);
    }
  }

  private setBusy(busy: boolean): void {
    this.busy = busy;
    this.editor.setReadOnly(busy);
    this.root.dataset.busy = String(busy);
    this.root.querySelectorAll<HTMLButtonElement>("[data-action]").forEach((button) => {
      button.disabled = busy;
    });
  }

  private scheduleRender(): void {
    if (this.renderFrame) {
      return;
    }

    this.renderFrame = window.requestAnimationFrame(() => {
      this.renderFrame = 0;
      this.render();
    });
  }

  private render(): void {
    const dirty = this.documentSession.dirty;
    const saveStatus = this.element<HTMLElement>("#save-status");

    const documentName = this.element<HTMLElement>("#document-name");
    const documentPath = this.element<HTMLElement>("#document-path");
    documentName.textContent = this.documentSession.displayName;
    documentName.title = this.documentSession.path ?? this.documentSession.displayName;
    documentPath.textContent = this.documentSession.displayPath;
    documentPath.title = this.documentSession.displayPath;
    this.element<HTMLElement>("#dirty-dot").classList.toggle("dirty-dot--visible", dirty);
    this.element<HTMLElement>("#save-button").classList.toggle("command-button--dirty", dirty);
    this.element<HTMLElement>("#character-status").textContent = formatCharacterCount(
      this.snapshot.characterCount,
    );
    this.element<HTMLElement>("#cursor-status").textContent =
      `行 ${this.snapshot.line}、列 ${this.snapshot.column}`;
    this.element<HTMLElement>("#line-ending-status").textContent = this.snapshot.lineEnding;
    this.element<HTMLElement>("#document-kind-status").textContent = this.documentSession.kind;

    saveStatus.classList.toggle("save-status--dirty", dirty);
    saveStatus.lastChild!.textContent = dirty ? " 未保存" : " 保存済み";
    this.updateWindowTitle(this.documentSession.windowTitle);
  }

  private updateWindowTitle(title: string): void {
    document.title = title;
    if (title === this.lastWindowTitle) {
      return;
    }

    this.lastWindowTitle = title;
    if (!isTauriRuntime()) {
      return;
    }

    this.windowTitleUpdate = this.windowTitleUpdate
      .then(async () => {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        await getCurrentWindow().setTitle(title);
      })
      .catch((error: unknown) => {
        console.error("ウィンドウタイトルを更新できませんでした", error);
      });
  }

  private showToast(message: string, isError = false): void {
    const toast = this.element<HTMLElement>("#toast");
    window.clearTimeout(this.toastTimer);
    toast.textContent = message;
    toast.classList.toggle("toast--error", isError);
    toast.classList.add("toast--visible");
    this.toastTimer = window.setTimeout(() => toast.classList.remove("toast--visible"), 2400);
  }

  private async registerCloseGuard(): Promise<void> {
    if (!isTauriRuntime()) {
      return;
    }

    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const appWindow = getCurrentWindow();
    await appWindow.onCloseRequested(async (event) => {
      if (
        await shouldPreventWindowClose(this.documentSession.dirty, () =>
          this.canReplaceDocument(),
        )
      ) {
        event.preventDefault();
      }
    });
  }

  private element<T extends Element>(selector: string): T {
    const element = this.root.querySelector<T>(selector);
    if (!element) {
      throw new Error(`必要なUI要素が見つかりません: ${selector}`);
    }
    return element;
  }
}
