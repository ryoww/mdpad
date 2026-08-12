export type LineEnding = "LF" | "CRLF";

export function detectLineEnding(content: string): LineEnding {
  return content.includes("\r\n") ? "CRLF" : "LF";
}

export function normalizeLineEndings(content: string): string {
  return content.replace(/\r\n?/g, "\n");
}

export function splitEditorLines(content: string): string[] {
  return normalizeLineEndings(content).split("\n");
}

export function formatCharacterCount(count: number): string {
  return `${new Intl.NumberFormat("ja-JP").format(count)} 文字`;
}
