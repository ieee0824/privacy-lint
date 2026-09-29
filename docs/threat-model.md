# Threat model

## 守るもの

1. 利用者がフォームに入力する個人情報（氏名・連絡先・パスワード・決済情報など）
2. 利用者の閲覧行動（どのサイトを訪れたか）
3. Jev の API credential
4. 拡張機能そのものの完全性（誤った「問題なし」表示をさせられないこと）

## 想定する攻撃者と対策

| 攻撃者 | 想定する行為 | 対策 | 検証 |
|---|---|---|---|
| 悪意ある Web ページ | DOM にプロンプトインジェクションを書き、評価を「問題なし」に誘導する | 質問文は Relay の固定テンプレートのみ。ページ由来テキストは `state.website` 配下のデータとしてのみ渡し、質問文で「信頼しないデータ」と明示。最終レベルは型付き回答からコードで合成 | `relay/internal/jev/questions_test.go`、`tests/pipeline.test.ts`、fixture X |
| 悪意ある Web ページ | 拡張の UI に HTML / スクリプトを注入する | ページ由来文字列は所見に保存しない。表示は `textContent` のみ。通知は closed shadow root | 静的検査（`innerHTML` 等の禁止）、`tests/pipeline.test.ts` |
| 悪意ある Web ページ | `window.postMessage` や `window.chrome` の差し替えで拡張と通信する | content script は ISOLATED world で動作し、ページのメッセージを購読しない。background は `sender.id` と送信元 frame・origin を検証 | 静的検査、fixture X の E2E |
| 悪意ある Web ページ | 巨大な DOM・長大なラベルで処理を止める / 送信量を増やす | 走査件数・文字数の上限、スキーマ検証（拡張と Relay の両方） | `tests/pipeline.test.ts` adversarial DOM |
| 悪意ある Web ページ | 送信先 URL の query に仕込んだ値や hidden input の値を送らせる | URL は origin のみ、hidden input は分類対象外、値は読まない | fixture X の E2E（`HIDDEN-SESSION-CANARY` 等） |
| Web ページ経由の Relay 悪用 | 訪問者のブラウザから Relay を Jev proxy として使う | CORS は拡張 origin のみ許可、`application/json` 必須（preflight を強制）、固定質問のみ | `relay/internal/api/handler_test.go` |
| Relay の運用者 / ログ閲覧者 | ログから閲覧履歴や入力内容を得る | body・IP・URL・任意パスを記録しない | `TestLogsContainNoContentOrAddresses`、E2E の relay ログ検査 |
| 拡張パッケージの解析者 | 配布物から Jev credential を取り出す | 拡張は credential を持たない。Relay の環境変数にのみ置く | 静的検査（`api.typesafe.ai` 等の参照禁止） |
| 上流（Jev）の障害 | 障害時に「問題なし」と表示させる | 失敗は `jev_unavailable`、回答欠落・曖昧は unknown として扱い、NORMAL に落とさない | `tests/composer.test.ts`、`tests/pipeline.test.ts` |

## 残存リスク

- **origin は Relay に送られる。** 文書内容の評価を有効にしている限り、Relay 運用者は
  「どの origin で個人情報フォームが表示されたか」を観測しうる（ログには残さない設計）。
  気になる場合は設定で外部送信を無効化できる（その場合は `insufficient_information` になる）。
- **ページの作者が書いたテキストに第三者の個人情報が含まれうる。**
  見出し・ラベル・フッターは伏せ字処理するが、氏名のような自由文は検出できない。
  送信範囲を見出し・ラベル・フッター・短い抜粋に限定して影響を抑えている。
- **キャッシュキーのハッシュは辞書攻撃で origin を推測されうる。** 端末ローカルのみに保存され、TTL で削除される。
- **Jev の判断は誤りうる。** 日本語は公式に精度が低いとされる。低確信の回答は unknown として扱い、
  「詐欺」「危険」などの断定表示は行わない。
- **部品のバージョンは偽装・誤推測されうる。** `Server` ヘッダーや URL の版はサイト側で自由に変えられ、
  Linux ディストリビューションは古い版番号のままセキュリティ修正を取り込むことがある。
  そのため「サポートが終了した版が使われている」という兆候として扱い、脆弱性とは表示しない（DESIGN.md §44）。
- **iframe 内フォームは MVP では評価しない。** 決済フォームが cross-origin iframe で埋め込まれている場合、
  top frame に個人情報欄が無ければ何も表示されない。
- **`--e2e` ビルドにはテスト用のストレージ取得フックがある。** 通常ビルドに混入するとビルドが失敗する。
  `dist/*-e2e` を配布してはならない。
