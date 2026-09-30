# Privacy model

privacy-lint が「何を読み、何を送り、何を保存するか」の一覧。
不変条件は [DESIGN.md §3](../DESIGN.md) が正であり、この文書はその実装上の対応表である。

## 読み取るもの / 読み取らないもの

| 対象 | 扱い | 実装 |
|---|---|---|
| 入力欄の属性（`type` / `name` / `id` / `autocomplete` / `placeholder` / `required`） | 読む | `content/form-scanner.ts` |
| 入力欄のラベル・見出し・フッター・リンク文字列（作者が書いたテキスト） | 読む（伏せ字・長さ制限あり） | `content/dom-text.ts` |
| 入力欄の値（`.value`、`value` 属性、checked、選択状態、`FormData`） | **読まない** | 静的検査 + value getter の罠で検証 |
| `contenteditable` 内のテキスト | **読まない** | `content/dom-text.ts` |
| `input` / `change` / `keydown` / `paste` 等のイベント | **購読しない**（`focusin` の発生のみ） | `content/ui-trigger.ts` |
| Cookie / localStorage / sessionStorage / IndexedDB / クリップボード | **読まない** | 静的検査 |
| 通信 | origin と initiator 種別のみ（Resource Timing API）。本文・ヘッダは構造的に参照不可 | `content/resource-scanner.ts` |
| `script` / `link` / Resource Timing の URL、`<meta name="generator">` | 部品のバージョン推測に使う。部品 ID と数値の版だけを残し、URL は保持しない | `content/component-scanner.ts` |
| ポリシー等を取得した際の `Server` / `X-Powered-By` ヘッダー | ページと同じサイトの場合のみ、部品のバージョン推測に使う | `background/assessment.ts` |
| スクリーンショット | **取得しない** | 静的検査 |
| iframe 内のフォーム | MVP では読まない（top frame のみ） | `allFrames: false` |

## 外部送信するもの（設定で無効化可能）

送信先は Privacy Relay のみ。Relay が固定の質問文を付けて Jev に中継する。

| 項目 | 例 |
|---|---|
| ページの origin・URL の種類 | `https://shop.example`, `checkout` |
| ページタイトル・見出し・フッター（伏せ字済み、最大 120〜300 文字） | `ご注文手続き` |
| 入力欄の種類・ラベル・必須か | `{kind: "address", label: "住所", required: true}` |
| フォームの method、送信先が別 origin / 別サイトか（真偽値のみ） | `crossSiteAction: true` |
| ポリシー / 運営者ページから抽出した短い抜粋（最大 12 件 × 280 文字） | `利用目的: 商品の発送のため` |
| 第三者 origin の **数** | `scriptOrigins: 3` |

送信しないもの: URL のパス・クエリ・フラグメント、送信先 origin そのもの、第三者 origin の名前、
入力値、ページ本文全体、リンク先 URL、検出した部品とそのバージョン（拡張内でのみ判定）。

伏せ字（`privacy/sanitizer.ts`）: メールアドレス → `[email]`、電話番号 → `[phone]`、
カード番号（Luhn）→ `[card]`、8 桁以上の数字列 → `[number]`、JWT / 長いトークン → `[token]`、URL → `[url]`。

## 保存するもの

| 保存先 | 内容 | 期間 |
|---|---|---|
| `storage.local` `settings` | Relay URL、Relay 認証値、外部送信の可否、ページ内通知の可否 | 利用者が変更するまで |
| `storage.local` `assessment:<sha256>` | 評価結果（レベル・所見 ID・状態、サポート終了の部品名）。キーは origin・観測署名・評価に関わる設定の SHA-256 ハッシュ（設定の値そのものは保存しない） | TTL（1〜24 時間）経過で削除 |
| `storage.session` `tab:<id>` / `obs:<id>` | タブごとの評価状態と最新の観測データ | タブを閉じる・遷移する・ブラウザ終了で消える |

保存しないもの: 閲覧履歴、入力値、ページ本文、ポリシー全文、利用者の識別子。
所見（findings）にはページ由来の文字列を入れない（ID と件数のみ）。

## Privacy Relay が保持しないもの

request body、Jev への入力、URL、IP アドレス、User-Agent。
IP アドレスは rate limit 用にメモリ上で現在の1分ウィンドウの間だけ保持し、ウィンドウ終了時にタイマーで削除する。
新しいアクセスがなくても削除し、Relay の停止時にも rate limiter を解放する。
アクセスログは request ID・既知ルート名・status・latency・schema version・byte 数のみ（`relay/internal/logging`）。

## 権限

| 権限 | 用途 |
|---|---|
| `storage` | 設定・キャッシュ・タブ状態 |
| `scripting` | 許可された origin への content script 登録 |
| `activeTab` | popup で現在のタブの origin を知り「このサイトで有効化」を出すため |
| `optional_host_permissions: http(s)://*/*` | 利用者が許可した場合のみ。サイト単位または全サイト |

`cookies` / `history` / `tabs` / `webRequest` / `clipboardRead` / `downloads` / `debugger` / `nativeMessaging` は要求しない（テストで検証）。

Firefox では `browser_specific_settings.gecko.data_collection_permissions` に
`browsingActivity`（origin）と `websiteContent`（抽出テキスト）を申告している。
