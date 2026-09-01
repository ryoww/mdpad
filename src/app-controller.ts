import { shouldPreventWindowClose } from "./close-guard";
import { DocumentSession } from "./document-session";
import { MarkdownEditor, type EditorSnapshot } from "./editor";
import { getEditorZoomDelta } from "./editor-zoom";
import type { FileGateway } from "./file-gateway";
import { isTauriRuntime } from "./file-gateway";
import { PREVIEW_CHARACTER_LIMIT, renderMarkdownPreview } from "./markdown-preview";
import { formatCharacterCount } from "./text-format";

type ActionName =
  | "find"
  | "line-wrap"
  | "new"
  | "open"
  | "preview"
  | "redo"
  | "save"
  | "save-as"
  | "undo"
  | "zoom-in"
  | "zoom-out";

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
  private editorScrollProgressBeforePreview = 0;
  private lastWindowTitle = "";
  private openMenu: string | null = null;
  private previewFrame = 0;
  private previewRevision = 0;
  private renderedPreviewKind: "Markdown" | "Text" | null = null;
  private renderedPreviewRevision = -1;
  private previewVisible = false;
  private renderFrame = 0;
  private toastTimer = 0;
  private windowTitleUpdate = Promise.resolve();

  constructor(
    private readonly root: HTMLElement,
    private readonly files: FileGateway,
  ) {
    const editorHost = this.element<HTMLElement>("#editor");
    this.editor = new MarkdownEditor(editorHost, (snapshot, documentChanged) => {
      this.snapshot = snapshot;
      this.documentSession.setDirty(snapshot.dirty);
      this.scheduleRender();
      if (documentChanged) {
        this.previewRevision += 1;
        this.schedulePreviewRender();
      }
    });
  }

  async start(): Promise<void> {
    this.bindCommands();
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
    this.root.querySelectorAll<HTMLButtonElement>("[data-menu-trigger]").forEach((trigger) => {
      trigger.addEventListener("click", () => {
        const menu = trigger.dataset.menuTrigger!;
        this.openMenu = this.openMenu === menu ? null : menu;
        this.renderMenus();
      });
    });

    this.root.querySelectorAll<HTMLButtonElement>("[data-action]").forEach((button) => {
      button.addEventListener("click", () => {
        const action = button.dataset.action as ActionName;
        this.closeMenus();
        void this.runAction(action);
      });
    });

    this.root.addEventListener("click", (event) => {
      if (!(event.target instanceof Element) || !event.target.closest("[data-menu-root]")) {
        this.closeMenus();
      }
    });

    window.addEventListener(
      "keydown",
      (event) => {
        if (event.key === "Escape" && this.openMenu) {
          event.preventDefault();
          event.stopPropagation();
          this.closeMenus(true);
          return;
        }

        if (
          event.altKey &&
          !event.ctrlKey &&
          !event.metaKey &&
          event.key.toLocaleLowerCase() === "z"
        ) {
          event.preventDefault();
          event.stopPropagation();
          this.closeMenus();
          void this.runAction("line-wrap");
          return;
        }

        const zoomDelta = getEditorZoomDelta(event);
        if (zoomDelta !== 0) {
          event.preventDefault();
          event.stopPropagation();
          this.adjustEditorFontSize(zoomDelta);
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
        if (key === "v" && event.shiftKey) action = "preview";
        const targetIsInsideEditor =
          event.target instanceof Element && event.target.closest(".cm-editor") !== null;
        if (!targetIsInsideEditor && key === "z") {
          action = event.shiftKey ? "redo" : "undo";
        }
        if (!targetIsInsideEditor && key === "y") action = "redo";

        if (action) {
          event.preventDefault();
          event.stopPropagation();
          this.closeMenus();
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
      this.showEditor();
      this.editor.openSearch();
      return;
    }

    if (action === "preview") {
      this.togglePreview();
      return;
    }

    if (action === "line-wrap") {
      this.toggleLineWrapping();
      return;
    }

    if (action === "undo") {
      this.showEditor();
      this.editor.undo();
      this.editor.focus();
      return;
    }

    if (action === "redo") {
      this.showEditor();
      this.editor.redo();
      this.editor.focus();
      return;
    }

    if (action === "zoom-in" || action === "zoom-out") {
      this.adjustEditorFontSize(action === "zoom-in" ? 1 : -1);
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
    this.showEditor();
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

  private adjustEditorFontSize(delta: number): void {
    const fontSize = this.editor.adjustFontSize(delta);
    this.element<HTMLElement>("#preview").style.setProperty(
      "--mdpad-preview-font-size",
      `${fontSize}px`,
    );
    this.showToast(`文字サイズ ${fontSize}px`);
  }

  private toggleLineWrapping(): void {
    const lineWrapping = !this.editor.isLineWrapping();
    this.editor.setLineWrapping(lineWrapping);
    this.renderLineWrapping();
    this.showToast(lineWrapping ? "行を折り返します" : "横スクロールで表示します");
  }

  private closeMenus(restoreFocus = false): void {
    const menu = this.openMenu;
    if (!menu) {
      return;
    }

    this.openMenu = null;
    this.renderMenus();
    if (restoreFocus) {
      this.root.querySelector<HTMLButtonElement>(`[data-menu-trigger="${menu}"]`)?.focus();
    }
  }

  private renderMenus(): void {
    this.root.querySelectorAll<HTMLButtonElement>("[data-menu-trigger]").forEach((trigger) => {
      const isOpen = trigger.dataset.menuTrigger === this.openMenu;
      trigger.setAttribute("aria-expanded", String(isOpen));
      const menu = this.element<HTMLElement>(`#${trigger.getAttribute("aria-controls")}`);
      menu.hidden = !isOpen;
    });
  }

  private togglePreview(): void {
    if (this.previewVisible) {
      this.showEditor();
      return;
    }

    this.editorScrollProgressBeforePreview = this.editor.getScrollProgress();
    this.previewVisible = true;
    this.renderPreview();
    this.renderViewMode();
    this.setScrollProgress(
      this.element<HTMLElement>("#preview-region"),
      this.editorScrollProgressBeforePreview,
    );
    this.element<HTMLElement>("#preview").focus();
  }

  private showEditor(): void {
    if (!this.previewVisible) {
      return;
    }

    const previewRegion = this.element<HTMLElement>("#preview-region");
    const hasPreviewScroll = previewRegion.scrollHeight > previewRegion.clientHeight;
    const restoreProgress = hasPreviewScroll
      ? this.getScrollProgress(previewRegion)
      : this.editorScrollProgressBeforePreview;
    this.previewVisible = false;
    this.renderViewMode();
    this.editor.restoreView(restoreProgress);
    this.editor.focus();
  }

  private schedulePreviewRender(): void {
    if (!this.previewVisible || this.previewFrame) {
      return;
    }

    this.previewFrame = window.requestAnimationFrame(() => {
      this.previewFrame = 0;
      if (this.previewVisible) {
        this.renderPreview();
      }
    });
  }

  private renderPreview(): void {
    const previewKind = this.documentSession.kind;
    if (
      this.renderedPreviewRevision === this.previewRevision &&
      this.renderedPreviewKind === previewKind
    ) {
      return;
    }

    const preview = this.element<HTMLElement>("#preview");
    const emptyState = this.element<HTMLElement>("#preview-empty");
    const emptyTitle = emptyState.querySelector<HTMLElement>("strong")!;
    const emptyDescription = emptyState.querySelector<HTMLElement>("span")!;
    preview.replaceChildren();

    if (this.snapshot.characterCount > PREVIEW_CHARACTER_LIMIT) {
      emptyState.hidden = false;
      emptyTitle.textContent = "プレビューできるサイズを超えています";
      emptyDescription.textContent = "高速な編集を保つため、2 MiB以下の文書を表示できます。";
    } else {
      const source = this.editor.getValue();
      if (source.length > PREVIEW_CHARACTER_LIMIT) {
        emptyState.hidden = false;
        emptyTitle.textContent = "プレビューできるサイズを超えています";
        emptyDescription.textContent = "高速な編集を保つため、2 MiB以下の文書を表示できます。";
      } else if (source.trim().length === 0) {
        emptyState.hidden = false;
        emptyTitle.textContent = "プレビューする内容がありません";
        emptyDescription.textContent = "編集画面に戻ってMarkdownを書き始めてください。";
      } else {
        emptyState.hidden = true;
        if (previewKind === "Text") {
          const preformatted = document.createElement("pre");
          preformatted.className = "plain-text-preview";
          preformatted.textContent = source;
          preview.replaceChildren(preformatted);
        } else {
          preview.replaceChildren(renderMarkdownPreview(source));
        }
      }
    }

    this.renderedPreviewKind = previewKind;
    this.renderedPreviewRevision = this.previewRevision;
    preview.style.setProperty(
      "--mdpad-preview-font-size",
      `${this.editor.getFontSize()}px`,
    );
  }

  private getScrollProgress(element: HTMLElement): number {
    const scrollableHeight = element.scrollHeight - element.clientHeight;
    return scrollableHeight > 0 ? element.scrollTop / scrollableHeight : 0;
  }

  private setScrollProgress(element: HTMLElement, scrollProgress: number): void {
    const scrollableHeight = Math.max(0, element.scrollHeight - element.clientHeight);
    element.scrollTop = scrollableHeight * Math.min(1, Math.max(0, scrollProgress));
  }

  private renderViewMode(): void {
    this.element<HTMLElement>("#editor-region").hidden = this.previewVisible;
    this.element<HTMLElement>("#preview-region").hidden = !this.previewVisible;
    const button = this.element<HTMLButtonElement>("#preview-button");
    button.setAttribute("aria-pressed", String(this.previewVisible));
    button.classList.toggle("menu-item--active", this.previewVisible);
  }

  private renderLineWrapping(): void {
    const lineWrapping = this.editor.isLineWrapping();
    const button = this.element<HTMLButtonElement>("#line-wrap-button");
    button.setAttribute("aria-pressed", String(lineWrapping));
    button.classList.toggle("menu-item--active", lineWrapping);
    this.element<HTMLElement>("#line-wrap-status").hidden = !lineWrapping;
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
    this.element<HTMLElement>("#save-button").classList.toggle("menu-item--dirty", dirty);
    this.element<HTMLElement>("#cursor-status").textContent =
      `行 ${this.snapshot.line}、列 ${this.snapshot.column}`;

    // 既定の状態は書かない。LF・Markdown・空文書・保存済みは黙り、逸脱したときだけ出す。
    const characterStatus = this.element<HTMLElement>("#character-status");
    characterStatus.textContent = formatCharacterCount(this.snapshot.characterCount);
    characterStatus.hidden = this.snapshot.characterCount === 0;

    const lineEndingStatus = this.element<HTMLElement>("#line-ending-status");
    lineEndingStatus.textContent = this.snapshot.lineEnding;
    lineEndingStatus.hidden = this.snapshot.lineEnding === "LF";

    const kindStatus = this.element<HTMLElement>("#document-kind-status");
    kindStatus.textContent = this.documentSession.kind;
    kindStatus.hidden = this.documentSession.kind === "Markdown";

    saveStatus.hidden = !dirty;
    this.renderViewMode();
    this.renderLineWrapping();
    this.schedulePreviewRender();
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
