# Design QA

## Comparison target

- Source visual truth: クリップボード経由で受け取った一時ファイル。リポジトリ外に置かれ、すでに削除されているため参照できない
- Secondary title-bar reference: 同上（タイトルバー確認用に別途受け取った一時ファイル）
- Implementation capture: `design-qa-implementation.png`
- Side-by-side evidence: `design-qa-comparison.png`
- State: dark theme, new unsaved document, all menus closed, editor visible
- Browser viewport: 785 × 839 CSS px, device pixel ratio 1
- Compared crop: 319 × 43 CSS px and 319 × 43 image px
- Source raster: 319 × 43 px; no density metadata was available, so it was compared 1:1 with the implementation crop

## Findings

- No actionable P0, P1, or P2 differences remain.
- Fonts and typography: the three labels match the source hierarchy and weight. The implementation keeps the user-selected PlemolJP Console NF, so its glyph widths differ slightly from the proportional source font; this is an accepted P3 difference.
- Spacing and layout rhythm: the menu bar is 28px high and the first two label positions align closely with the source. The third label begins about 10px earlier because of the selected monospace font; accepted as P3.
- Colors and visual tokens: the menu bar uses the source top-left color `#1b2029`. The editor background below the crop intentionally retains mdpad's existing darker workspace color because only the top UI was selected as the target.
- Image quality and asset fidelity: the selected UI contains no image assets or icons. The implementation likewise uses only text and native controls.
- Copy and content: `ファイル`, `編集`, `表示` match exactly. No unrelated controls remain in the closed top-bar state.

## Full-view comparison evidence

`design-qa-comparison.png` places the 319 × 43 source on the left and the final 319 × 43 implementation on the right. The bar height, three-item structure, dark palette, and compact density match at 1:1 scale.

Focused region comparison was not needed because the entire selected target is a 319 × 43 strip and all three labels are readable at 1:1 in the full-view comparison.

## Interaction and runtime checks

- Opened the File menu and verified it became visible.
- Switched directly to the View menu.
- Toggled Markdown preview on and back to the editor.
- Verified the preview button's pressed state.
- Verified Ctrl+Z and Ctrl+Y while focus was on the Edit disclosure button.
- Verified Ctrl+Z inside the CodeMirror search field stays with the editor instead of invoking document-level undo.
- Verified the disclosures use native button semantics instead of claiming an unimplemented ARIA menubar keyboard model.
- Verified no browser console warnings or errors.
- Verified the built Tauri app changed its native window title to the full opened path: `C:\Users\ryo\Documents\mdpad\README.md — mdpad`.

## Comparison history

1. Initial browser measurement found a 29px bar and 13px Plemol labels, which made the menu noticeably wider than the 28px source.
2. Reduced the bar to 28px, the labels to 12px, and horizontal padding to 10px.
3. Sampled the source bar color and changed the implementation token to `#1b2029`.
4. Recaptured at the same 319 × 43 size; the final side-by-side evidence has no remaining P0/P1/P2 mismatch.

## Implementation checklist

- [x] Keep only File, Edit, and View in the closed top bar.
- [x] Preserve New, Open, Save, Save As, Undo, Redo, Find, Preview, and Zoom inside menus.
- [x] Keep the full document path in the native window title.
- [x] Preserve keyboard shortcuts and accessibility state.
- [x] Rebuild the Windows application and NSIS installer.

## Follow-up polish

- P3: If exact glyph spacing becomes more important than the requested PlemolJP font, use a proportional system UI font only for the menu bar.

final result: passed

## 2026-09-01 の方針変更（この記録は現行の目標ではない）

上記の 1:1 比較は「参照画像のメニューバーに合わせる」ことを目標にしていた。
その後、UI が生成物っぽく見えるという指摘を受けて方針を変えたため、**この記録は達成状態の記録であって現行の目標ではない**。

- Windows ネイティブの外観に寄せる目標は取り下げた。ダークを既定とすることだけを維持する。
- メニューバーの色は参照画像から採った `#1b2029` ではなく、共通トークン `--mdpad-bg-raised` を使う。
  そのため参照画像との 1:1 一致はもう成立しない。
- 配色は `src/styles.css` の `:root` に集約し、`src/editor.ts` からも同じ変数を参照する。
- シンタックスハイライトは記法記号を沈める向きに反転させた（変更前は見出し=紫・リスト記号=緑・
  コード=橙・引用=青緑の 5 色）。
- ステータスバーは既定値を表示しない方式に変更した。`localhost Preview` の実行環境ラベルは削除。

再度この参照画像に合わせ直す場合は、上の方針変更を先に取り消す必要がある。
