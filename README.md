# Kata — Haskell workspace

## 機能の概要

小さなHaskellの問題を解くための、Electron製デスクトップIDEです。白を基調に、左にファイル一覧、中央にエディタとGHCi、右にAIアシスタントを配置しています。

- 既存フォルダーの `.hs` を更新日時の新しい順に表示。手動保存とGHCi読み込み時に保存。
- Haskellのシンタックスハイライト、Vimキー操作、ファイル内の単語補完。
- フォント・配色テーマの設定、領域のサイズ調整、ウィンドウ位置の復元。
- ファイルごとのGHCiターミナル。補完・履歴・対話入力に対応。
- ⌘EnterでGHCiを起動してファイルを読込、起動済みなら再読込。GHCiのエラーを裏でAIが解析し、該当行の横に日本語の説明を表示。
- Codex app-serverを利用したAI相談。モデル・推論レベルの選択、Web検索、GHCiエラーの即時送信。

操作方法とショートカットは[使い方](docs/usage.md)、開発・環境変数・検証は[開発ドキュメント](docs/development.md)を参照してください。

## 起動方法

Node.js 22.12以降、GHC/GHCi、Codex CLIを用意して実行します。

```sh
./start.sh
```

初回は必要な依存パッケージを自動インストールし、ビルドして起動します。別のディレクトリから絶対パスで実行することもできます。AIを使う前に、未ログインの場合はターミナルで `codex login` を実行してください。

## Macアプリのビルド

macOS上で実行します。必要な依存パッケージのインストール、画面のビルド、アイコン付き `.app` の生成をまとめて行います。

```sh
./build-mac.sh
```

生成先は `release/Kata-darwin-arm64/Kata.app`（Apple Silicon）または `release/Kata-darwin-x64/Kata.app`（Intel）です。`Kata.app` をアプリケーションフォルダーへコピーして起動できます。GHC/GHCi・Codex CLIは別途インストールが必要です。

アイコン・設定の保存先・署名などの詳細は[Macアプリのビルド詳細](docs/mac-build.md)を参照してください。
