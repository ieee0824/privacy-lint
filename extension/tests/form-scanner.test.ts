// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ControlRegistry } from "../src/content/control-registry";
import { buildObservation } from "../src/content/page-observer";
import { validatePageObservation } from "../src/shared/validate";
import { expectNoCanary, trapValueAccess } from "./helpers/canary";

const FORM_HTML = `
  <header><h1>ご予約フォーム</h1></header>
  <main>
    <section>
      <h2>宿泊予約</h2>
      <form method="post" action="https://forms.example-provider.net/submit?session=SESSIONSECRET123">
        <fieldset><legend>お客様情報</legend>
          <label for="n">氏名 <span>*</span></label>
          <input id="n" name="real_name" autocomplete="name" placeholder="例: 予約 花子" required value="山田太郎">
          <label>メールアドレス <input type="email" name="mail" value="taro@example.com"></label>
          <label>電話番号 <input type="tel" name="tel"></label>
          <label>住所 <textarea name="address">東京都千代田区千代田1-1</textarea></label>
          <label>生年月日 <input type="date" name="birthday" value="1985-04-01"></label>
          <label>カード番号 <input name="cc" autocomplete="cc-number"></label>
          <label>パスワード <input type="password" name="pw" value="super-secret-password"></label>
          <label>都道府県 <select name="pref"><option>選択</option><option selected>東京都</option></select></label>
          <input type="hidden" name="csrf" value="HIDDENTOKENVALUE">
          <input type="search" name="q">
        </fieldset>
        <button type="submit">予約を確定する</button>
      </form>
    </section>
  </main>
  <footer>運営: 株式会社サンプル旅館 TEL 03-1111-2222 info@sample-ryokan.example <a href="/company?ref=footer">会社概要</a> <a href="/privacy#top">プライバシーポリシー</a></footer>
  <script src="https://analytics.example-tracker.com/t.js"></script>
`;

let restore: () => void = () => {};

beforeEach(() => {
  document.body.innerHTML = FORM_HTML;
  document.title = "予約 | サンプル旅館";
  // Simulate the user typing (these values live only in the controls' dirty value state).
  (document.querySelector('[name="tel"]') as HTMLInputElement).value = "090-9876-5432";
  (document.querySelector('[name="cc"]') as HTMLInputElement).value = "4111 1111 1111 1111";
  (document.querySelector('[name="real_name"]') as HTMLInputElement).value = "山田太郎";
  restore = trapValueAccess(window);
});

afterEach(() => restore());

function observe() {
  const registry = new ControlRegistry();
  registry.addFrom(document);
  return buildObservation(document, registry, { getEntriesByType: () => [] });
}

describe("form scanning (privacy invariants)", () => {
  it("never reads values and never emits canaries", () => {
    const observation = observe();
    expect(observation).not.toBeNull();
    expectNoCanary(observation, ["HIDDENTOKENVALUE", "SESSIONSECRET123", "03-1111-2222", "info@sample-ryokan"]);
  });

  it("produces a schema-valid observation", () => {
    const observation = observe()!;
    expect(() => validatePageObservation(JSON.parse(JSON.stringify(observation)))).not.toThrow();
  });

  it("classifies fields from structure only", () => {
    const o = observe()!;
    const kinds = o.form.fields.map((f) => f.kind);
    expect(kinds).toEqual(["name", "email", "phone", "address", "birthdate", "payment", "password", "address"]);
    expect(o.form.fields[0]!.required).toBe(true);
    expect(o.form.fields[0]!.label).toBe("氏名 *");
    // select option texts are not part of the label
    expect(o.form.fields[7]!.label).toBe("都道府県");
  });

  it("records the submission target as an origin only", () => {
    const o = observe()!;
    expect(o.form.method).toBe("post");
    expect(o.form.actionOrigin).toBe("https://forms.example-provider.net");
    expect(o.form.crossOriginAction).toBe(true);
    expect(o.form.context).toContain("お客様情報");
    expect(o.form.context).toContain("予約を確定する");
  });

  it("finds policy and operator links without query strings", () => {
    const o = observe()!;
    expect(o.links.privacy[0]!.url).toBe(`${location.origin}/privacy`);
    expect(o.links.operator[0]!.url).toBe(`${location.origin}/company`);
  });

  it("sanitizes contact details in page text", () => {
    const o = observe()!;
    expect(o.page.footer).toContain("[phone]");
    expect(o.page.footer).toContain("[email]");
    expect(o.page.headings).toEqual(["ご予約フォーム", "宿泊予約"]);
  });

  it("collects third-party script origins", () => {
    const o = observe()!;
    expect(o.resources).toContainEqual({ origin: "https://analytics.example-tracker.com", kind: "script" });
  });

  it("returns null when no sensitive field exists", () => {
    document.body.innerHTML = `<form><input type="search" name="q"><input name="keyword"></form>`;
    expect(observe()).toBeNull();
  });

  it("the value trap itself is effective", () => {
    const input = document.querySelector("input")!;
    expect(() => input.value).toThrow(/forbidden/);
    expect(() => input.getAttribute("value")).toThrow(/forbidden/);
    expect(() => new FormData()).toThrow(/forbidden/);
  });

  it("uses table and definition-list cells as labels", () => {
    restore();
    document.body.innerHTML = `<form><table>
      <tr><td>お名前</td><td><input name="f1"></td></tr>
      <tr><th>ご住所</th><td><input name="f2"></td></tr>
    </table><dl><dt>電話番号</dt><dd><input name="f3"></dd></dl></form>`;
    restore = trapValueAccess(window);
    expect(observe()!.form.fields.map((f) => [f.kind, f.label])).toEqual([
      ["name", "お名前"],
      ["address", "ご住所"],
      ["phone", "電話番号"],
    ]);
  });

  it("skips contenteditable text", () => {
    document.body.innerHTML = `<form><label>氏名<div contenteditable>山田太郎</div><input name="name"></label></form>`;
    expectNoCanary(observe());
  });
});
