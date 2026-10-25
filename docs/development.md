# 開発と検証

## 開発時の起動

```sh
npm run dev
```

## 環境変数

| 変数 | 用途 |
| --- | --- |
| `KATA_WORKSPACE` | 起動時に開くフォルダー（保存済みの選択より優先） |
| `KATA_GHCI` | GHCi実行ファイルのパス |
| `KATA_CODEX` | Codex CLI実行ファイルのパス |
| `KATA_RUNTIME` | 開発中のElectron設定・キャッシュ保存先 |

## 検証

```sh
npm test                # ファイル操作・フォルダー設定・移行・実GHCi・Codex通信
npm run build           # TypeScriptチェックとproductionビルド
npm run test:electron   # GUIを起動できる環境でElectronの操作テスト
```

通常のテストでは、既存 `.hs` の読み込み、更新日時順、直接保存、同名ファイルの保護、フォルダー設定の記憶、旧形式からの移行を確認します。GHCiは実際のプロセスで動作を確認し、Codexの回答生成はテスト用app-serverで検証します。
実PTYのGHCiで計算・診断検知・再読込・リサイズ・複数行・対話入力・Ctrl+C・終了と再起動を確認します。Tab補完・上下キー履歴のテストも用意していますが、実行環境で `/dev/tty` のオープンが禁止されている場合は明示的にスキップします。この制限下ではGHCi自身が行編集を無効にするためです。

Electron画面でAIサイドバーの開閉・幅調整と復元、GHCiの入力保持、エラー添付、一行入力からの送信、モデルと推論レベルの選択・復元をテスト用app-serverで確認しています。実Codex app-serverでもモデル一覧取得とWeb検索によるHaskell公式サイトの取得を確認済みです。ネイティブのフォルダー選択ダイアログは未確認です。

実装参照: [公式Codex app-serverドキュメント](https://developers.openai.com/codex/app-server)。
Web検索設定: [公式Codex設定リファレンス](https://developers.openai.com/codex/config-reference)。

端末実装: [xterm.js API](https://xtermjs.org/docs/api/terminal/classes/terminal/)、[node-pty](https://github.com/microsoft/node-pty)。
エディタ配色の参考: [Catppuccin](https://github.com/catppuccin/catppuccin)、[Rosé Pine](https://rosepinetheme.com/palette/)、[Solarized](https://ethanschoonover.com/solarized/)。各ライトパレットをCodeMirror向けに調整しています。
