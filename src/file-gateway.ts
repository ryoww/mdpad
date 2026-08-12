export interface OpenedDocument {
  content: string;
  path: string;
}

export interface SaveRequest {
  content: string;
  currentPath: string | null;
  forceNewPath: boolean;
  suggestedName: string;
}

export interface FileGateway {
  readonly runtimeLabel: string;
  confirmDiscard(message: string): Promise<boolean>;
  open(): Promise<OpenedDocument | null>;
  openStartup(): Promise<OpenedDocument | null>;
  save(request: SaveRequest): Promise<string | null>;
}

export function canReuseBrowserHandle(
  request: Pick<SaveRequest, "currentPath" | "forceNewPath">,
): boolean {
  return Boolean(request.currentPath) && !request.forceNewPath;
}

export function isPickerCancellation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AbortError"
  );
}

export interface WritableFileHandle {
  createWritable(): Promise<{
    close(): Promise<void>;
    write(data: string): Promise<void>;
  }>;
  getFile(): Promise<File>;
  name: string;
}

interface PickerWindow extends Window {
  showOpenFilePicker?: (options: object) => Promise<WritableFileHandle[]>;
  showSaveFilePicker?: (options: object) => Promise<WritableFileHandle>;
}

const markdownFilters = [
  { name: "Markdown / テキスト", extensions: ["md", "markdown", "txt"] },
  { name: "すべてのファイル", extensions: ["*"] },
];

class TauriFileGateway implements FileGateway {
  readonly runtimeLabel = "Tauri Desktop";

  async openStartup(): Promise<OpenedDocument | null> {
    const { invoke } = await import("@tauri-apps/api/core");
    const path = await invoke<string | null>("startup_file_path");
    if (!path) {
      return null;
    }

    const content = await invoke<string>("read_text_file", { path });
    return { content, path };
  }

  async open(): Promise<OpenedDocument | null> {
    const [{ invoke }, { open }] = await Promise.all([
      import("@tauri-apps/api/core"),
      import("@tauri-apps/plugin-dialog"),
    ]);
    const selected = await open({
      directory: false,
      multiple: false,
      filters: markdownFilters,
      title: "Markdown またはテキストを開く",
    });

    if (typeof selected !== "string") {
      return null;
    }

    const content = await invoke<string>("read_text_file", { path: selected });
    return { content, path: selected };
  }

  async save(request: SaveRequest): Promise<string | null> {
    const [{ invoke }, { save }] = await Promise.all([
      import("@tauri-apps/api/core"),
      import("@tauri-apps/plugin-dialog"),
    ]);

    let path = request.currentPath;
    if (request.forceNewPath || !path) {
      path = await save({
        defaultPath: path ?? request.suggestedName,
        filters: markdownFilters,
        title: "名前を付けて保存",
      });
    }

    if (!path) {
      return null;
    }

    await invoke("write_text_file", { path, content: request.content });
    return path;
  }

  async confirmDiscard(message: string): Promise<boolean> {
    const { confirm } = await import("@tauri-apps/plugin-dialog");
    return confirm(message, {
      cancelLabel: "編集に戻る",
      kind: "warning",
      okLabel: "変更を破棄",
      title: "未保存の変更",
    });
  }
}

export class BrowserFileGateway implements FileGateway {
  readonly runtimeLabel = "localhost Preview";
  private currentHandle: WritableFileHandle | null = null;

  async openStartup(): Promise<OpenedDocument | null> {
    return null;
  }

  async open(): Promise<OpenedDocument | null> {
    const browserWindow = window as PickerWindow;
    if (browserWindow.showOpenFilePicker) {
      let handles: WritableFileHandle[];
      try {
        handles = await browserWindow.showOpenFilePicker({
          multiple: false,
          types: [
            {
              accept: { "text/plain": [".md", ".markdown", ".txt"] },
              description: "Markdown / テキスト",
            },
          ],
        });
      } catch (error) {
        if (isPickerCancellation(error)) {
          return null;
        }
        throw error;
      }

      const [handle] = handles;
      if (!handle) {
        return null;
      }

      const file = await handle.getFile();
      const content = await file.text();
      this.currentHandle = handle;
      return { content, path: file.name };
    }

    const file = await this.pickWithInput();
    if (!file) {
      return null;
    }

    const content = await file.text();
    this.currentHandle = null;
    return { content, path: file.name };
  }

  async save(request: SaveRequest): Promise<string | null> {
    const browserWindow = window as PickerWindow;
    let handle = canReuseBrowserHandle(request) ? this.currentHandle : null;

    if (!handle && browserWindow.showSaveFilePicker) {
      try {
        handle = await browserWindow.showSaveFilePicker({
          suggestedName: request.currentPath ?? request.suggestedName,
          types: [
            {
              accept: { "text/markdown": [".md", ".markdown"], "text/plain": [".txt"] },
              description: "Markdown / テキスト",
            },
          ],
        });
      } catch (error) {
        if (isPickerCancellation(error)) {
          return null;
        }
        throw error;
      }
    }

    if (handle) {
      const writable = await handle.createWritable();
      await writable.write(request.content);
      await writable.close();
      this.currentHandle = handle;
      return handle.name;
    }

    let fileName = request.currentPath ?? request.suggestedName;
    if (request.forceNewPath || !request.currentPath) {
      const selectedName = window.prompt("保存するファイル名", request.suggestedName);
      if (selectedName === null) {
        return null;
      }
      fileName = selectedName.trim() || request.suggestedName;
    }
    const blob = new Blob([request.content], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    return fileName;
  }

  async confirmDiscard(message: string): Promise<boolean> {
    return window.confirm(message);
  }

  private pickWithInput(): Promise<File | null> {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".md,.markdown,.txt,text/plain,text/markdown";
      input.addEventListener("change", () => resolve(input.files?.item(0) ?? null), { once: true });
      input.addEventListener("cancel", () => resolve(null), { once: true });
      input.click();
    });
  }
}

export function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

export function createFileGateway(): FileGateway {
  return isTauriRuntime() ? new TauriFileGateway() : new BrowserFileGateway();
}
