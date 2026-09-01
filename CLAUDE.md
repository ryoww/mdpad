# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## このリポジトリの位置づけ

Windows 向けの、機能を絞った Markdown メモ帳。Tauri 2（Rust）+ Vite + TypeScript + CodeMirror 6。
フレームワーク（React / Vue 等）は使わず、素の DOM 操作と TypeScript クラスだけで UI を組んでいる。
タブ、ファイルツリー、プラグイン、クラウド同期はスコープ外（README.md「スコープ」参照）。

UI 文言・エラーメッセージ・コミット対象のドキュメントはすべて日本語。新しい文言を追加するときも日本語で書く。

## コマンド

パッケージマネージャは **npm** を使う。`src-tauri/tauri.conf.json` の `beforeDevCommand` / `beforeBuildCommand` が
`npm run dev` / `npm run build` を直接呼んでいるため、pnpm へ切り替えるとその設定も同時に変える必要がある。

| 用途 | コマンド |
| --- | --- |
| 依存関係のインストール | `npm install` |
| ブラウザで UI 開発（http://127.0.0.1:1420、strictPort） | `npm run dev` |
| Tauri デスクトップアプリを起動 | `npm run tauri dev` |
| 型チェック + フロントエンドビルド | `npm run build` |
| NSIS インストーラーを含む配布ビルド | `npm run tauri build` |
| フロントエンドのテスト（1 回実行） | `npm test` |
| フロントエンドのテスト（watch） | `npm run test:watch` |
| 単一ファイルのテスト | `npm test -- src/editor.test.ts` |
| テスト名で絞り込み | `npm test -- -t "プレビュー"` |
| Rust 側のテスト | `cargo test --manifest-path src-tauri/Cargo.toml` |

lint ツールは導入していない。品質ゲートは `npm run build` の `tsc --noEmit`（`strict` + `noUnusedLocals` +
`noUnusedParameters`）と Vitest / `cargo test` のみ。編集後は少なくとも `npm test` と `npm run build` を通す。

## アーキテクチャ

### レイヤー構成

`index.html` が UI の構造（DOM）を静的に持ち、`src/main.ts` が `#app` を `AppController` に渡すだけ。
テンプレートエンジンやコンポーネントはない。**UI 要素を追加するときは `index.html` と、それを参照する
`AppController` の両方を変更する**必要がある。

- `src/app-controller.ts` — 唯一のオーケストレーター。キーバインド、メニュー開閉、アクション実行、
  ステータスバー描画、トースト、プレビュー切替、ウィンドウタイトル更新を担う。DOM 参照は必ず
  `this.element<T>(selector)` 経由で行い、要素が無ければ例外にする。
- `src/editor.ts` (`MarkdownEditor`) — CodeMirror 6 のラッパー。エディターの内部状態（フォントサイズ、
  行折り返し、read-only、保存済みスナップショット）を Compartment で切り替える。dirty 判定は
  `state.doc.eq(this.savedSnapshot)` による文書比較で、変更カウントには依存しない。
- `src/file-gateway.ts` — ファイル I/O の抽象化。`createFileGateway()` が `isTauriRuntime()` を見て
  `TauriFileGateway`（`invoke` + dialog プラグイン）か `BrowserFileGateway`（File System Access API →
  `<input type=file>` / ダウンロードへ段階的フォールバック）を返す。`AppController` はこの
  `FileGateway` インターフェイスにしか依存しないので、テストではモックを注入できる。
- `src/document-session.ts` — パスと dirty フラグから表示名・表示パス・ウィンドウタイトル・
  文書種別（`.txt` なら `Text`、それ以外は `Markdown`）を導出する。
- `src/markdown-preview.ts` — `marked` でパースし DOMPurify で **タグを許可リスト方式に限定し
  属性は全面禁止**（`ALLOWED_ATTR: []`）してから `DocumentFragment` を返す。プレビュー上限は 2 MiB
  (`PREVIEW_CHARACTER_LIMIT`)。
- 小さな純粋関数モジュール（`close-guard.ts` / `editor-zoom.ts` / `text-format.ts`）— 判定ロジックだけを
  切り出して DOM なしでテストできるようにしている。新しい判定ロジックもこの粒度で切り出す方針。

### Rust 側（`src-tauri/src/lib.rs`）

公開している command は 3 つだけ: `read_text_file` / `write_text_file` / `startup_file_path`。

- 読み込みは UTF-8 のみ。先頭の UTF-8 BOM は除去し、UTF-8 でなければ日本語のエラーを返す。
- 保存は**アトミック書き込み**。同ディレクトリに一時ファイルを作って `sync_all` した後、Windows では
  `ReplaceFileW`（既存ファイルのメタデータを保持）、新規作成時は `MoveFileExW` で置き換える。
  置換に失敗して保存先が消えた場合は一時ファイルを復旧用として残し、そのパスをエラーに含める。
  この復旧経路の挙動を変えるときは `retains_recovery_content_if_the_destination_disappears` を必ず確認する。
- `startup_file_path` はコマンドライン第 1 引数を絶対パス化し、実在するファイルのときだけ返す。
  これが Explorer の「mdpadで開く」の入口。
- 権限は `src-tauri/capabilities/default.json` の最小許可のみ。新しい Tauri API を使うときはここに追加する。
- Explorer 右クリックメニューの登録・削除は `src-tauri/windows/installer-hooks.nsh`（NSIS フック）で行う。

### 状態管理の要点

ステータスバーは**既定値を表示しない**。常に出るのはファイル名・カーソル位置だけで、
`未保存`・文字数・`CRLF`・`Text`・`折り返し` は既定から外れたときだけ `hidden` を解除する
（`LF`・`Markdown`・`横スクロール`・空文書・保存済みは既定なので黙る）。文字コードは Rust 側が
UTF-8 しか扱わないため表示自体を持たない。項目を増やすときはこの規則に従うか、規則ごと見直す。

`AppController` は「イベント → 状態更新 → `render()`」の一方向。`render()` は毎回ステータスバー全体を
書き直す。連続描画を避けるため `scheduleRender()` / `schedulePreviewRender()` が
`requestAnimationFrame` で 1 フレームに集約し、プレビューは `previewRevision` と描画済みリビジョンの
比較で再レンダリングを省略する。長い文書でも軽く保つための仕組みなので、ここを素朴な同期描画に
戻さないこと。

ファイル操作中は `withBusyState()` が `busy` フラグ・エディターの read-only・全ボタンの disabled を
まとめて切り替え、例外はトーストに変換する。非同期のファイル操作は必ずこれを通す。

## 注意すべき制約

- **配色の定義元は `src/styles.css` の `:root` だけ**。`--mdpad-*` カスタムプロパティに集約してある。
  `src/editor.ts` の `mdpadEditorTheme` / `mdpadHighlightStyle` も同じ変数を `var(--mdpad-x, #fallback)`
  で参照する。**新しい生の 16 進数を書かない**。フォールバック値は `styles.css` を読み込まずに
  `MarkdownEditor` 単体で使われる場合の保険で、jsdom のテストもここに依存している。
  有彩色は `--mdpad-accent` / `--mdpad-code` / `--mdpad-attention` / `--mdpad-danger` の 4 つだけ。
  構造は色ではなく明度 4 段（`text-strong` / `text` / `text-dim` / `text-faint`）で表す方針。
- **Markdown の記法記号は沈める**。`mdpadHighlightStyle` は `#`・`-`・`>`・`**`・`` ` ``（`tags`
  では `processingInstruction` / `meta` / `punctuation` / `contentSeparator`）を `--mdpad-text-faint` に落とし、
  見出しや強調の**中身**を明るくする。記号に色を付けると本文より記法が目立つため、この向きを反転させない。
- **CodeMirror の `baseTheme` は色を持ち込んでくる**。`.cm-selectionMatch`（緑）、`.cm-matchingBracket`
  （青緑）、`.cm-nonmatchingBracket`（赤）、`.cm-specialChar`（赤）、`.cm-searchMatch`（黄・橙）は
  素のままだとパレット外の色が本文に現れる。`mdpadEditorTheme` で明示的に上書きしてあるので、
  拡張を追加したら同様に既定色が漏れていないか実ブラウザで確認する。
  `.cm-focused` 付きのセレクタは同じ詳細度で当てないと勝てない。
- **改行コードは維持する**。読み込み時に `detectLineEnding()` で LF / CRLF を判定し、
  `EditorState.lineSeparator` に反映する。エディター内部は常に LF に正規化して扱う。
- **Ctrl+Z / Ctrl+Y の扱い**。エディター（`.cm-editor` 配下）にフォーカスがあるときは CodeMirror の
  history に任せ、`AppController` は横取りしない。検索パネル内での undo が文書全体の undo に
  なってしまう不具合を避けるための分岐。
- **ブラウザとデスクトップで挙動が分岐する**。`isTauriRuntime()` の分岐（終了確認、ウィンドウタイトル、
  `beforeunload`、ファイル I/O）を壊さないこと。`npm run dev` のブラウザ確認だけでは Tauri 側の経路は
  検証できない。
- Tauri の CSP（`tauri.conf.json`）は `default-src 'self'` ベース。外部リソースを取得する実装は通らない。
- `@tauri-apps/api` は常に動的 `import()` で読む。ブラウザ実行時にバンドルを読み込ませないため。

## テストの書き方

- テストは `src/**/*.test.ts` に実装と同じ場所へ置く。
- Vitest の既定環境は `node`。DOM が必要なファイルは先頭に `// @vitest-environment jsdom` を書く
  （`app-controller.test.ts` / `editor.test.ts` / `file-gateway.test.ts` / `markdown-preview.test.ts` がその例）。
- `AppController` のテストは `createAppRoot()` で `index.html` の必要な要素だけを持つ最小 DOM を組み、
  `FileGateway` のモックを注入する。`index.html` の id / `data-action` を変えたらこのヘルパーも直す。
- CodeMirror を使うテストは `afterEach` で `view.destroy()` する（既存テストのパターンに合わせる）。
- テストは実装の詳細ではなく振る舞いを検証する。カバレッジ稼ぎのテストは書かない。

## コメント・コミット規約（AGENTS.md より）

- コードには How
- テストコードには What
- コミットログには Why
- コードコメントには Why not

質問が `?` または `？` で終わる場合は実装せず回答のみ行う。
