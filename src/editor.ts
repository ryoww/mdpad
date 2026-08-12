import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import {
  HighlightStyle,
  bracketMatching,
  indentOnInput,
  syntaxHighlighting,
} from "@codemirror/language";
import {
  highlightSelectionMatches,
  openSearchPanel,
  search,
  searchKeymap,
} from "@codemirror/search";
import { Compartment, EditorState, Text } from "@codemirror/state";
import {
  EditorView,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  placeholder,
  rectangularSelection,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { DEFAULT_EDITOR_FONT_SIZE, clampEditorFontSize } from "./editor-zoom";
import { detectLineEnding, splitEditorLines, type LineEnding } from "./text-format";

export interface EditorSnapshot {
  characterCount: number;
  column: number;
  dirty: boolean;
  line: number;
  lineEnding: LineEnding;
}

export interface EditorSaveSnapshot {
  content: string;
  document: Text;
}

const mdpadHighlightStyle = HighlightStyle.define([
  { tag: tags.heading, color: "#d4b7ff", fontWeight: "700" },
  { tag: [tags.strong, tags.emphasis], color: "#f3f5f8" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: [tags.link, tags.url], color: "#83b6ff", textDecoration: "none" },
  { tag: tags.monospace, color: "#f2bf77" },
  { tag: tags.quote, color: "#8fd4c7", fontStyle: "italic" },
  { tag: [tags.meta, tags.processingInstruction], color: "#778197" },
  { tag: [tags.list, tags.punctuation], color: "#a8d28d" },
  { tag: tags.contentSeparator, color: "#4c5360" },
]);

const mdpadEditorTheme = EditorView.theme(
  {
    "&": {
      height: "100%",
      color: "#dfe3ea",
      backgroundColor: "#0b0d10",
      fontSize: "var(--mdpad-editor-font-size, 15px)",
    },
    "&.cm-focused": { outline: "none" },
    ".cm-scroller": {
      overflow: "auto",
      overscrollBehavior: "contain",
      scrollbarColor: "#39414e #0b0d10",
      scrollbarGutter: "stable",
      scrollbarWidth: "thin",
      touchAction: "pan-x pan-y",
      fontFamily:
        '"PlemolJP Console NF", "PlemolJP Console", "Cascadia Code", Consolas, monospace',
      lineHeight: "1.72",
    },
    ".cm-scroller::-webkit-scrollbar": { width: "11px", height: "11px" },
    ".cm-scroller::-webkit-scrollbar-track": { backgroundColor: "#0b0d10" },
    ".cm-scroller::-webkit-scrollbar-thumb": {
      backgroundColor: "#39414e",
      border: "3px solid #0b0d10",
      borderRadius: "99px",
    },
    ".cm-scroller::-webkit-scrollbar-thumb:hover": { backgroundColor: "#515b6a" },
    ".cm-content": {
      caretColor: "#9db2ff",
      padding: "26px 0 36vh",
    },
    ".cm-line": { padding: "0 28px 0 12px" },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "#b8c5ff", borderLeftWidth: "2px" },
    ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": {
      backgroundColor: "#2b3e69 !important",
    },
    ".cm-activeLine": { backgroundColor: "#11151c" },
    ".cm-gutters": {
      minWidth: "58px",
      color: "#7a8392",
      backgroundColor: "#0b0d10",
      border: "none",
    },
    ".cm-lineNumbers .cm-gutterElement": { minWidth: "38px", padding: "0 10px 0 8px" },
    ".cm-activeLineGutter": { color: "#aeb7c5", backgroundColor: "#11151c" },
    ".cm-panels": {
      color: "#dfe3ea",
      backgroundColor: "#12161d",
      borderBottom: "1px solid #262c36",
    },
    ".cm-panel.cm-search": { padding: "10px 14px 10px 64px" },
    ".cm-panel.cm-search input": {
      color: "#eef1f5",
      backgroundColor: "#0b0d10",
      border: "1px solid #303744",
      borderRadius: "7px",
      padding: "6px 9px",
      outline: "none",
    },
    ".cm-panel.cm-search input:focus": { borderColor: "#768de0", boxShadow: "0 0 0 3px #768de022" },
    ".cm-panel.cm-search button": {
      color: "#c7ccd5",
      background: "#1b2029",
      border: "1px solid #303744",
      borderRadius: "6px",
      padding: "5px 8px",
    },
    ".cm-searchMatch": { backgroundColor: "#7c5b1c88", outline: "1px solid #b98928" },
    ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "#2e589e", outlineColor: "#6291e8" },
    ".cm-placeholder": { color: "#7b8492", fontStyle: "normal" },
  },
  { dark: true },
);

export class MarkdownEditor {
  private readonly readOnlyState = new Compartment();
  private readonly editableView = new Compartment();
  private readonly view: EditorView;
  private savedSnapshot: Text;
  private fontSize = DEFAULT_EDITOR_FONT_SIZE;
  private lineEnding: LineEnding = "LF";
  private readOnly = false;

  constructor(parent: HTMLElement, private readonly onSnapshot: (snapshot: EditorSnapshot) => void) {
    const state = this.createState("", "LF");

    this.savedSnapshot = state.doc;
    this.view = new EditorView({ state, parent });
    this.applyFontSize();
    this.emitSnapshot(this.view.state);
  }

  private createState(content: string, lineEnding: LineEnding): EditorState {
    const separator = lineEnding === "CRLF" ? "\r\n" : "\n";

    return EditorState.create({
      doc: Text.of(splitEditorLines(content)),
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        history(),
        drawSelection(),
        dropCursor(),
        EditorState.allowMultipleSelections.of(true),
        indentOnInput(),
        bracketMatching(),
        rectangularSelection(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        search({ top: true }),
        markdown(),
        syntaxHighlighting(mdpadHighlightStyle),
        syntaxHighlighting(HighlightStyle.define([])),
        keymap.of([...searchKeymap, ...historyKeymap, indentWithTab, ...defaultKeymap]),
        EditorState.lineSeparator.of(separator),
        this.readOnlyState.of(EditorState.readOnly.of(this.readOnly)),
        this.editableView.of(EditorView.editable.of(!this.readOnly)),
        EditorState.tabSize.of(2),
        EditorView.contentAttributes.of({
          "aria-label": "Markdown エディター",
          autocapitalize: "off",
          autocomplete: "off",
          spellcheck: "true",
        }),
        placeholder("# メモを書き始める"),
        mdpadEditorTheme,
        EditorView.updateListener.of((update) => {
          if (update.docChanged || update.selectionSet) {
            this.emitSnapshot(update.state);
          }
        }),
      ],
    });
  }

  focus(): void {
    this.view.focus();
  }

  openSearch(): void {
    openSearchPanel(this.view);
    this.view.focus();
  }

  getValue(): string {
    return this.view.state.sliceDoc();
  }

  adjustFontSize(delta: number): number {
    const fontSize = clampEditorFontSize(this.fontSize + delta);
    if (fontSize === this.fontSize) {
      return this.fontSize;
    }

    this.fontSize = fontSize;
    this.applyFontSize();
    return this.fontSize;
  }

  getFontSize(): number {
    return this.fontSize;
  }

  private applyFontSize(): void {
    this.view.dom.style.setProperty("--mdpad-editor-font-size", `${this.fontSize}px`);
    this.view.requestMeasure();
  }

  createSaveSnapshot(): EditorSaveSnapshot {
    return {
      content: this.getValue(),
      document: this.view.state.doc,
    };
  }

  setReadOnly(readOnly: boolean): void {
    if (this.readOnly === readOnly) {
      return;
    }

    this.readOnly = readOnly;
    this.view.dispatch({
      effects: [
        this.readOnlyState.reconfigure(EditorState.readOnly.of(readOnly)),
        this.editableView.reconfigure(EditorView.editable.of(!readOnly)),
      ],
    });
  }

  setContent(content: string): void {
    this.lineEnding = detectLineEnding(content);
    const state = this.createState(content, this.lineEnding);
    this.savedSnapshot = state.doc;
    this.view.setState(state);
    this.emitSnapshot(state);
  }

  markSaved(snapshot: EditorSaveSnapshot): void {
    this.savedSnapshot = snapshot.document;
    this.emitSnapshot(this.view.state);
  }

  private emitSnapshot(state: EditorState): void {
    const head = state.selection.main.head;
    const line = state.doc.lineAt(head);

    this.onSnapshot({
      characterCount: state.doc.length,
      column: head - line.from + 1,
      dirty: !state.doc.eq(this.savedSnapshot),
      line: line.number,
      lineEnding: this.lineEnding,
    });
  }
}
