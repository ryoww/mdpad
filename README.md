# mdpad

Windows向けの、高速で省機能なMarkdownメモ帳です。Tauri 2とCodeMirror 6を使い、書くことに必要な操作だけを1画面にまとめています。

## 現在の機能

- `.md` / `.markdown` / `.txt` の新規作成、オープン、保存、名前を付けて保存
- Markdownシンタックスハイライト、行番号、検索、サニタイズ済みプレビュー
- UTF-8読み書き（UTF-8 BOMは読み込み時に除去）
- LF / CRLFの維持
- ステータスバーは既定値を出さない（常時はファイル名とカーソル位置、未保存・文字数・CRLF・Text・折り返しは該当時のみ）
- 長い行の折り返し / 横スクロール切替
- ファイル・編集・表示だけに整理した上部メニュー
- Tauriのウィンドウタイトルとブラウザのタブタイトルに現在のパスを表示
- 未保存変更がある場合の破棄・終了確認
- Windows Explorerの右クリックメニューから「mdpadで開く」
- localhostでも動くブラウザ用ファイル操作フォールバック

## 開発

```powershell
npm install
npm run dev
```

ブラウザで `http://localhost:1420` を開くとUIを調整できます。

Tauriアプリを起動する場合:

```powershell
npm run tauri dev
```

テストとビルド:

```powershell
npm test
npm run build
npm run tauri build
```

生成されたNSISインストーラーでインストールすると、`.md` / `.markdown` / `.txt` の右クリックメニューに「mdpadで開く」が追加されます。アンインストールすると同じ項目も削除されます。Windows 11では「その他のオプションを確認」の中に表示されます。

## ショートカット

| 操作 | キー |
| --- | --- |
| 新規 | `Ctrl+N` |
| 開く | `Ctrl+O` |
| 保存 | `Ctrl+S` |
| 名前を付けて保存 | `Ctrl+Shift+S` |
| 検索 | `Ctrl+F` |
| プレビュー切替 | `Ctrl+Shift+V` |
| 行の折り返し切替 | `Alt+Z` |
| 拡大 / 縮小 | `Ctrl++` / `Ctrl+-` |

## スコープ

初期版は編集体験に集中しています。タブ、ファイルツリー、プラグイン、クラウド同期は含みません。
