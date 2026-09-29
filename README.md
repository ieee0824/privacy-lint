# privacy-lint

Webサイトで個人情報を入力する前に、「追加で確認した方がよいか」の材料を提示するブラウザ拡張（Firefox / Chrome）。

サイトが安全か危険かは判定しません。
運営者情報・プライバシーポリシー・フォームの送信先・外部スクリプトなど、観測できた事実と、
小さな意味判断（[TypeSafe Jev](https://docs.typesafe.ai)）をコードで合成し、根拠付きで表示します。

- 設計: [DESIGN.md](DESIGN.md)
- 何を読み・送り・保存するか: [docs/privacy-model.md](docs/privacy-model.md)
- 脅威モデル: [docs/threat-model.md](docs/threat-model.md)
- スコアリング: [docs/scoring.md](docs/scoring.md)

## 構成

```text
extension/   ブラウザ拡張（TypeScript, Manifest V3, Firefox / Chrome 共通ソース）
relay/       Privacy Relay（Go）。Jev の credential を持つ唯一のコンポーネント
fixtures/    評価用ページ（DESIGN.md §34 の A〜H と adversarial）
docs/        privacy model / threat model / scoring
```

## 必要なもの

- Node.js 20 以上
- Go 1.25 以上
- Firefox 140 以上 / Chrome 120 以上

## ビルド

```sh
cd extension
npm install
npm run build          # dist/firefox と dist/chrome を生成
```

Relay の URL はビルド時に埋め込まれます（既定: `http://127.0.0.1:8787`）。設定画面からも変更できます。

```sh
node scripts/build.mjs --relay-url=https://relay.example.com
```

## Relay の起動

本物の Jev を使う場合は、環境変数 `JEV_API_KEY` に credential を設定して起動します。

```sh
cd relay
go run ./cmd/relay
```

Jev の API キーが無い場合は、キーワードベースの mock で動作を確認できます。

```sh
go run ./cmd/jevmock &                            # 127.0.0.1:8788
go run ./cmd/relay -jev-endpoint http://127.0.0.1:8788/v1/systemone
```

| フラグ / 環境変数 | 説明 |
|---|---|
| `-addr` | 待ち受けアドレス（既定 `127.0.0.1:8787`） |
| `-jev-endpoint` / `-jev-model` | Jev のエンドポイント / モデル（既定 `jev-latest`） |
| `-rate` | クライアントあたりの 1 分間のリクエスト上限（既定 30、0 で無効） |
| `-trust-proxy` | 信頼できるリバースプロキシの背後でのみ指定（`X-Forwarded-For` を使う） |
| `JEV_API_KEY` | Jev の credential |
| `RELAY_BEARER` | 設定すると `Authorization: Bearer <値>` を必須にする（拡張の設定画面の「Relay トークン」） |

## ブラウザへの読み込み

### Firefox

```sh
cd extension
npm run dev:firefox    # web-ext で一時的に読み込んだ Firefox を起動
```

または `about:debugging#/runtime/this-firefox` →「一時的なアドオンを読み込む」→ `extension/dist/firefox/manifest.json`。

### Chrome

`chrome://extensions` → デベロッパーモード →「パッケージ化されていない拡張機能を読み込む」→ `extension/dist/chrome`。

### 初回設定

インストール直後に設定画面が開きます。どのサイトにもアクセスしない状態で始まるので、次のどちらかで有効にします。

- 設定画面の「すべてのサイトで有効化」
- 評価したいページでツールバーのアイコン →「このサイトで有効化」

## テスト

```sh
cd extension
npm run typecheck
npm test               # ユニット・静的不変条件・パイプライン・fixture 統合テスト（Go の relay / mock を起動）
npm run test:e2e       # 実ブラウザ E2E（Firefox + Chromium）。canary 値が外部にも storage にも出ないことを検証

cd ../relay
go test ./...
```

E2E の初回は Chromium の取得が必要です: `npx playwright install chromium`。
Firefox はインストール済みのものを使います（別の場所にある場合は `FIREFOX_BIN` で指定）。

## 既知の制約（MVP）

- iframe 内のフォームは評価しません（top frame のみ）。
- 通信の観測は Resource Timing API と `script` / `iframe` 要素に基づく簡易集計です（`webRequest` は未使用）。
- Jev は日本語の精度が英語より低いと公式に記載されています。重みと閾値は実データで調整が必要です。
