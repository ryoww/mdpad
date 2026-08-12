export const DEFAULT_EDITOR_FONT_SIZE = 15;
export const MIN_EDITOR_FONT_SIZE = 10;
export const MAX_EDITOR_FONT_SIZE = 28;

export type EditorZoomDelta = -1 | 0 | 1;

export function clampEditorFontSize(fontSize: number): number {
  return Math.min(MAX_EDITOR_FONT_SIZE, Math.max(MIN_EDITOR_FONT_SIZE, fontSize));
}

export function getEditorZoomDelta(
  event: Pick<KeyboardEvent, "altKey" | "code" | "ctrlKey" | "key" | "metaKey">,
): EditorZoomDelta {
  if (!event.ctrlKey || event.altKey || event.metaKey) {
    return 0;
  }

  if (event.key === "+" || event.key === "=" || event.code === "NumpadAdd") {
    return 1;
  }

  if (event.key === "-" || event.code === "NumpadSubtract") {
    return -1;
  }

  return 0;
}
