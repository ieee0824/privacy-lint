# Scoring

`extension/src/risk/` の合成ロジックの説明。重みや閾値は仮説であり、fixture と実データで調整する（DESIGN.md §20）。

## 流れ

```text
観測（決定論）──┐
                ├─► features（0〜1 または unknown）─► 重み付き平均 ─► レベル ─► 下限ルール ─► 状態
Jev 回答 ─► gate ┘
```

## Jev 回答のゲート（§19）

| 種類 | unknown とみなす条件 |
|---|---|
| Noul | `|noul − 0.5| < 0.25`（0.25〜0.75）。Noul には confidence が無いため |
| Score / Choice | `confidence < 0.5` |
| 質問されなかった | 根拠（抜粋など）が無い質問は Relay が送らない → unknown |

unknown は 0（低リスク）に置き換えない。

## Features

| feature | 重み | 決め方 |
|---|---|---|
| operatorTransparency | 0.20 | `1 − operator_identifiable`（0.75）と `1 − operator_contact_available`（0.25）の加重平均。回答が無く運営者リンクも無ければ 0.7 |
| privacyDisclosure | 0.25 | ポリシーのリンクが無ければ 1。取得できなければ unknown。あれば purpose 0.4 / collection・third party・contact 各 0.2 の加重平均 |
| policyFormAlignment | 0.20 | ポリシーが無ければ 1。あれば `1 − policy_covers_form_fields` |
| dataMinimization | 0.20 | Score（4 段階）を 0〜1 に正規化 |
| thirdPartyExposure | 0.10 | 第三者 script の registrable domain 数: 0→0、1〜2→0.2、3〜5→0.4、6〜10→0.7、11+→1.0（iframe 1 件ごとに +0.05） |
| technicalSignals | 0.05 | http ページ / http 送信先 → 1、別サイト送信 → 0.6、同一サイト別ホスト → 0.2 |
| componentMaintenance | 0.10 | サポート終了表（DESIGN.md §44）で判定。検出できなければ unknown（所見なし）、サポート終了の版が無ければ 0、終了から 1 年未満 0.5 / 3 年未満 0.75 / それ以上 1.0 |

`maintenance_signals`（Jev による文書の古さの判断）は説明用の所見のみで、重みを持たない（古い copyright だけで判断しないため）。
部品の版に基づく `componentMaintenance` は決定論なので重みを持つ。

## レベル

既知の feature のみで重み付き平均を取り、次の帯でレベルを決める。

| スコア | レベル |
|---|---|
| < 0.2 | 0 NORMAL |
| < 0.4 | 1 NOTICE |
| < 0.6 | 2 CAUTION |
| ≥ 0.6 | 3 VERIFY_BEFORE_INPUT |

下限ルール:

- http ページ、または http への送信 → VERIFY_BEFORE_INPUT
- パスワード・決済・本人確認情報を求め、ポリシーが見つからない → CAUTION 以上
- 入力要求が過剰（Score ≥ 約 1.75/3）→ CAUTION 以上
- ⚠ 所見が 1 つでもある → NOTICE 以上
- 状態が `evaluated` 以外 → NOTICE 以上

## 状態

| 状態 | 条件 | 表示 |
|---|---|---|
| evaluated | 既知の重みが 0.5 以上 | レベルに応じた見出し |
| insufficient_information | 既知の重みが 0.5 未満、または外部送信が無効 | 「判断に十分な情報が得られませんでした」 |
| jev_unavailable | Relay / Jev の失敗・不正な応答 | 「現在評価できません」 |
| permission_denied | そのサイトへのアクセスが未許可 | 「このサイトでは評価が有効になっていません」 |
| unsupported_page | http(s) 以外 | 「このページは評価の対象外です」 |

## キャッシュ TTL

| 結果 | TTL |
|---|---|
| NORMAL | 24 時間 |
| NOTICE | 12 時間 |
| CAUTION 以上 | 6 時間 |
| insufficient_information | 1 時間 |
| jev_unavailable | キャッシュしない |

## Fixture での期待値（Jev mock 使用）

| fixture | 期待 |
|---|---|
| A EC サイト | NORMAL、⚠ なし |
| B 古い予約サイト | CAUTION 以上、ポリシーなし・別サイト送信・サポート終了の部品（jQuery 1.x / Apache 2.2 / PHP 5） |
| C ニュースレター | CAUTION 以上、入力要求が過剰 |
| D 外部フォーム（説明あり） | NOTICE、⚠ は別サイト送信のみ |
| E フォームに触れないポリシー | CAUTION 以上、ポリシーとフォームの不一致・利用目的不明 |
| F 大量の解析スクリプト | NOTICE 以下、ℹ 件数表示 |
| G SPA | 後から生成されたフォームを検出 |
| H cross-origin iframe | top frame では評価しない |

`extension/tests/fixtures.integration.test.ts` がこの表を検証する。
Jev mock はキーワードベースなので、実際の Jev での値は別途計測して重みと閾値を調整すること。
