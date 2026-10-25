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
GHCiのエラー解析はチャットとは別の一時スレッドを使い、`turn/start.outputSchema` で `{ diagnostics: [{ index, displayLine, startColumn, endColumn, targetText, explanation }] }` を要求します。`index`はGHCiの診断一覧の添字、`displayLine`はAIが原因と修正箇所を判断した現在のソースの行番号（1始まり）です。行番号付きのソースとGHCi出力を渡し、GHCiの報告行と異なる行への表示にも対応します。`startColumn`・`endColumn`はUnicodeコードポイントで数えた1始まり・終了位置を含む文字範囲です。タブも1文字として数え、エディタ描画時にUTF-16位置へ変換します。`targetText`とソースの一致を検証し、文字位置がずれていても同じ行で一意に一致する対象文字列に限って補正します。範囲を確認できないときは下線を引きません。表示先の行が特定できない場合は0とし、ポップアップに表示します。診断番号・行番号・文字位置の整数性と範囲を検証し、元のGHCiの行・列は別に保持します。解析スレッドは読み取り専用・ツール使用禁止の指示・Web検索無効で、完了または失敗後に解放します。GHCiの読み込み完了は60秒、AIのターン完了は120秒でタイムアウトします。

通常のテストでは実GHCiによる明示的起動・同一プロセスでの再読み込み・型エラー・実行時例外・古いスナップショット拒否を確認し、テスト用app-serverでJSON形式・会話との分離・不正出力・接続切断を検証します。Electron操作テストではファイル選択だけでは未起動のままであること・実際のショートカットによる読込・文字範囲の下線と直下の説明表示・日本語／絵文字を含む文字位置の変換・チャット履歴の不変・編集中の説明保持・保存時と再読み込み時の消去・保存後の古いAI結果の非表示も確認します。
Web検索設定: [公式Codex設定リファレンス](https://developers.openai.com/codex/config-reference)。

端末実装: [xterm.js API](https://xtermjs.org/docs/api/terminal/classes/terminal/)、[node-pty](https://github.com/microsoft/node-pty)。
エディタ配色の参考: [Catppuccin](https://github.com/catppuccin/catppuccin)、[Rosé Pine](https://rosepinetheme.com/palette/)、[Solarized](https://ethanschoonover.com/solarized/)。各ライトパレットをCodeMirror向けに調整しています。

GHCiは起動時の一時スクリプトでプロンプトに不可視のOSCマーカーを設定します。PTYの出力が分割されてもプロンプト到達を検出し、その読み込み操作の出力だけを解析します。一時スクリプトはGHCi終了時に削除します。
