import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  redo as redoCommand,
  undo as undoCommand,
} from "@codemirror/commands";
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

// 記法の記号 (#, -, >, **, `) を沈め、本文を最前面に置く。記号へ色を付けると
// 書いた内容より記法のほうが目立ち、読み返すときに文章が頭に入らなくなる。
const mdpadHighlightStyle = HighlightStyle.define([
  {
    tag: [tags.processingInstruction, tags.meta, tags.punctuation, tags.contentSeparator],
    color: "var(--mdpad-text-faint, #757c87)",
  },
  { tag: tags.heading, color: "var(--mdpad-text-strong, #f1f3f6)", fontWeight: "700" },
  { tag: tags.strong, color: "var(--mdpad-text-strong, #f1f3f6)", fontWeight: "700" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: [tags.link, tags.url], color: "var(--mdpad-accent, #7ba3d9)", textDecoration: "none" },
  { tag: tags.monospace, color: "var(--mdpad-code, #b6a88c)" },
  { tag: tags.quote, color: "var(--mdpad-text-dim, #989fa9)" },
]);

// 色は styles.css の :root で定義した変数を参照する。フォールバック値は
// styles.css を読まずに MarkdownEditor 単体で使われる場合の保険。
const mdpadEditorTheme = EditorView.theme(
  {
    "&": {
      height: "100%",
      color: "var(--mdpad-text, #d6dae0)",
      backgroundColor: "var(--mdpad-bg, #0d0f13)",
      fontSize: "var(--mdpad-editor-font-size, 15px)",
    },
    "&.cm-focused": { outline: "none" },
    ".cm-scroller": {
      overflow: "auto",
      overscrollBehavior: "contain",
      scrollbarColor: "var(--mdpad-line-strong, #333944) var(--mdpad-bg, #0d0f13)",
      scrollbarGutter: "stable",
      scrollbarWidth: "thin",
      touchAction: "pan-x pan-y",
      fontFamily:
        '"PlemolJP Console NF", "PlemolJP Console", "Cascadia Code", Consolas, monospace',
      lineHeight: "1.75",
    },
    ".cm-scroller::-webkit-scrollbar": { width: "11px", height: "11px" },
    ".cm-scroller::-webkit-scrollbar-track": { backgroundColor: "var(--mdpad-bg, #0d0f13)" },
    ".cm-scroller::-webkit-scrollbar-thumb": {
      backgroundColor: "var(--mdpad-line-strong, #333944)",
      border: "3px solid var(--mdpad-bg, #0d0f13)",
      borderRadius: "99px",
    },
    ".cm-scroller::-webkit-scrollbar-thumb:hover": {
      backgroundColor: "var(--mdpad-text-faint, #757c87)",
    },
    ".cm-content": {
      caretColor: "var(--mdpad-text-strong, #f1f3f6)",
      padding: "22px 0 30vh",
    },
    ".cm-line": { padding: "0 28px 0 12px" },
    ".cm-cursor, .cm-dropCursor": {
      borderLeftColor: "var(--mdpad-text-strong, #f1f3f6)",
      borderLeftWidth: "2px",
    },
    ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": {
      backgroundColor: "var(--mdpad-select, #29405f) !important",
    },
    ".cm-activeLine": { backgroundColor: "var(--mdpad-bg-active, #14171d)" },
    ".cm-gutters": {
      minWidth: "52px",
      color: "var(--mdpad-text-faint, #757c87)",
      backgroundColor: "var(--mdpad-bg, #0d0f13)",
      border: "none",
    },
    ".cm-lineNumbers .cm-gutterElement": { minWidth: "34px", padding: "0 10px 0 8px" },
    ".cm-activeLineGutter": {
      color: "var(--mdpad-text-dim, #989fa9)",
      backgroundColor: "var(--mdpad-bg-active, #14171d)",
    },
    ".cm-panels": {
      color: "var(--mdpad-text, #d6dae0)",
      backgroundColor: "var(--mdpad-bg-raised, #16191f)",
      borderBottom: "1px solid var(--mdpad-line, #242830)",
    },
    ".cm-panel.cm-search": { padding: "8px 14px 8px 60px" },
    ".cm-panel.cm-search input": {
      color: "var(--mdpad-text-strong, #f1f3f6)",
      backgroundColor: "var(--mdpad-bg, #0d0f13)",
      border: "1px solid var(--mdpad-line-strong, #333944)",
      borderRadius: "4px",
      padding: "5px 8px",
      outline: "none",
    },
    ".cm-panel.cm-search input:focus": { borderColor: "var(--mdpad-focus, #6f92c9)" },
    ".cm-panel.cm-search button": {
      color: "var(--mdpad-text-dim, #989fa9)",
      background: "transparent",
      border: "1px solid var(--mdpad-line-strong, #333944)",
      borderRadius: "4px",
      padding: "4px 8px",
    },
    ".cm-panel.cm-search label": { color: "var(--mdpad-text-dim, #989fa9)" },
    // 一致箇所は面で示す。文字色を変えると本文の階層が崩れる。
    ".cm-searchMatch": { backgroundColor: "var(--mdpad-search-match, #384f6d)" },
    ".cm-searchMatch.cm-searchMatch-selected": {
      backgroundColor: "var(--mdpad-search-current, #41608a)",
      outline: "1px solid var(--mdpad-focus, #6f92c9)",
    },
    // 以下は CodeMirror の baseTheme が緑・赤・橙を当ててくる箇所。上書きしないと
    // 素の配色が漏れて、パレットにない色が本文に現れる。
    ".cm-selectionMatch": { backgroundColor: "var(--mdpad-surface-selected, #263243)" },
    ".cm-matchingBracket, &.cm-focused .cm-matchingBracket": {
      backgroundColor: "var(--mdpad-surface-selected, #263243)",
      color: "inherit",
    },
    ".cm-nonmatchingBracket, &.cm-focused .cm-nonmatchingBracket": {
      backgroundColor: "transparent",
      color: "var(--mdpad-danger, #d5908a)",
    },
    // 不可視文字は目立ってこそ意味がある。ここだけは警告色を使う。
    ".cm-specialChar": { color: "var(--mdpad-danger, #d5908a)" },
    ".cm-placeholder": { color: "var(--mdpad-text-faint, #757c87)", fontStyle: "normal" },
  },
  { dark: true },
);

export class MarkdownEditor {
  private readonly readOnlyState = new Compartment();
  private readonly editableView = new Compartment();
  private readonly lineWrappingState = new Compartment();
  private readonly view: EditorView;
  private savedSnapshot: Text;
  private fontSize = DEFAULT_EDITOR_FONT_SIZE;
  private lineEnding: LineEnding = "LF";
  private lineWrapping = false;
  private readOnly = false;

  constructor(
    parent: HTMLElement,
    private readonly onSnapshot: (
      snapshot: EditorSnapshot,
      documentChanged: boolean,
    ) => void,
  ) {
    const state = this.createState("", "LF");

    this.savedSnapshot = state.doc;
    this.view = new EditorView({ state, parent });
    this.applyFontSize();
    this.emitSnapshot(this.view.state, false);
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
        keymap.of([...searchKeymap, ...historyKeymap, indentWithTab, ...defaultKeymap]),
        EditorState.lineSeparator.of(separator),
        this.readOnlyState.of(EditorState.readOnly.of(this.readOnly)),
        this.editableView.of(EditorView.editable.of(!this.readOnly)),
        this.lineWrappingState.of(this.lineWrapping ? EditorView.lineWrapping : []),
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
            this.emitSnapshot(update.state, update.docChanged);
          }
        }),
      ],
    });
  }

  focus(): void {
    this.view.focus();
  }

  // openSearchPanel が検索欄へフォーカスを移す。ここで view.focus() を呼ぶと
  // 奪い返してしまい、Ctrl+F 直後の入力が検索語ではなく本文に入る。
  openSearch(): void {
    openSearchPanel(this.view);
  }

  undo(): boolean {
    return undoCommand(this.view);
  }

  redo(): boolean {
    return redoCommand(this.view);
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

  isLineWrapping(): boolean {
    return this.lineWrapping;
  }

  setLineWrapping(lineWrapping: boolean): void {
    if (this.lineWrapping === lineWrapping) {
      return;
    }

    this.lineWrapping = lineWrapping;
    this.view.dispatch({
      effects: this.lineWrappingState.reconfigure(
        lineWrapping ? EditorView.lineWrapping : [],
      ),
    });
    this.view.requestMeasure();
  }

  getScrollProgress(): number {
    const scroller = this.view.scrollDOM;
    const scrollableHeight = scroller.scrollHeight - scroller.clientHeight;
    return scrollableHeight > 0 ? scroller.scrollTop / scrollableHeight : 0;
  }

  restoreView(scrollProgress: number): void {
    this.view.requestMeasure({
      read: () => {
        const scroller = this.view.scrollDOM;
        return Math.max(0, scroller.scrollHeight - scroller.clientHeight) * scrollProgress;
      },
      write: (scrollTop) => {
        this.view.scrollDOM.scrollTop = scrollTop;
      },
    });
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
    this.emitSnapshot(state, true);
  }

  markSaved(snapshot: EditorSaveSnapshot): void {
    this.savedSnapshot = snapshot.document;
    this.emitSnapshot(this.view.state, false);
  }

  private emitSnapshot(state: EditorState, documentChanged: boolean): void {
    const head = state.selection.main.head;
    const line = state.doc.lineAt(head);

    this.onSnapshot(
      {
        characterCount: state.doc.length,
        column: head - line.from + 1,
        dirty: !state.doc.eq(this.savedSnapshot),
        line: line.number,
        lineEnding: this.lineEnding,
      },
      documentChanged,
    );
  }
}
