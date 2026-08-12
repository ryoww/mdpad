export type DocumentKind = "Markdown" | "Text";

export class DocumentSession {
  path: string | null = null;
  dirty = false;

  get displayName(): string {
    if (!this.path) {
      return "無題.md";
    }

    const parts = this.path.split(/[\\/]/);
    return parts.at(-1) || "無題.md";
  }

  get displayPath(): string {
    return this.path ?? "未保存の新規メモ";
  }

  get windowTitle(): string {
    const documentIdentifier = this.path ?? this.displayName;
    return `${this.dirty ? "● " : ""}${documentIdentifier} — mdpad`;
  }

  get kind(): DocumentKind {
    const lowerName = this.displayName.toLocaleLowerCase();
    return lowerName.endsWith(".txt") ? "Text" : "Markdown";
  }

  reset(): void {
    this.path = null;
    this.dirty = false;
  }

  load(path: string): void {
    this.path = path;
    this.dirty = false;
  }

  setDirty(dirty: boolean): void {
    this.dirty = dirty;
  }

  markSaved(path?: string): void {
    if (path) {
      this.path = path;
    }
    this.dirty = false;
  }
}
