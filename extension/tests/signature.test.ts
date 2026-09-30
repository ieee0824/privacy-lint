// @vitest-environment jsdom
/**
 * #16: every evaluation input is part of the signature; user-entered values never are.
 */
import { afterEach, describe, expect, it } from "vitest";
import { ControlRegistry } from "../src/content/control-registry";
import { watchForFormChanges } from "../src/content/mutation-observer";
import { buildObservation } from "../src/content/page-observer";
import { createReporter } from "../src/content/reporter";
import type { PageObservation } from "../src/shared/schema";
import { observationSignature } from "../src/shared/signature";
import { trapValueAccess } from "./helpers/canary";

const base = (): PageObservation => ({
  schemaVersion: 1,
  page: { origin: "https://a.example", scheme: "https", pathClass: "newsletter", title: "購読", headings: ["ニュースレター"], footer: "株式会社A" },
  form: {
    method: "post",
    actionScheme: "https",
    crossOriginAction: false,
    fieldCount: 2,
    fields: [
      { kind: "email", required: true, label: "メール" },
      { kind: "address", required: false, label: "住所" },
    ],
    context: ["購読する"],
  },
  links: { privacy: [], operator: [] },
  resources: [],
  components: [],
});

describe("observationSignature", () => {
  it.each<[string, (o: PageObservation) => void]>([
    ["title", (o) => (o.page.title = "資料請求")],
    ["headings", (o) => (o.page.headings = ["資料請求フォーム"])],
    ["path class", (o) => (o.page.pathClass = "checkout")],
    ["footer", (o) => (o.page.footer = "運営: 株式会社B")],
    ["form context", (o) => (o.form.context = ["申し込む"])],
    ["required state", (o) => (o.form.fields[1]!.required = true)],
    ["field label", (o) => (o.form.fields[1]!.label = "ご住所（任意）")],
  ])("changes with %s", (_name, mutate) => {
    const changed = base();
    mutate(changed);
    expect(observationSignature(changed)).not.toBe(observationSignature(base()));
  });

  it("changes when assessment resource counts change", () => {
    const changed = base();
    changed.resources = [{ origin: "https://ads.example", kind: "script" }];
    expect(observationSignature(changed)).not.toBe(observationSignature(base()));
  });

  it("ignores resource order, duplicates, and additional hosts within one third-party site", () => {
    const first = base();
    first.resources = [
      { origin: "https://one.ads.example", kind: "script" },
      { origin: "https://frames.other.example", kind: "iframe" },
    ];
    const second = { ...first, resources: [
      ...[...first.resources].reverse(), { origin: "https://two.ads.example", kind: "script" as const },
    ] };
    expect(observationSignature(first)).toBe(observationSignature(second));
  });
});

describe("signature never depends on user input", () => {
  let restore = () => {};
  afterEach(() => restore());

  it("typed values do not change the signature, and are never read", () => {
    document.body.innerHTML = `<h1>会員登録</h1><form><label>氏名 <input name="name"></label><label>メール <input type="email" name="email"></label></form>`;
    const sign = () => {
      const r = new ControlRegistry();
      r.addFrom(document);
      return observationSignature(buildObservation(document, r, undefined)!);
    };
    const before = sign();
    (document.querySelector('[name="name"]') as HTMLInputElement).value = "山田太郎";
    (document.querySelector('[name="email"]') as HTMLInputElement).value = "taro@example.com";
    restore = trapValueAccess(window);
    const after = sign();
    expect(after).toBe(before);
    expect(after).not.toMatch(/山田|taro@/);
  });
});

describe("re-reporting on SPA changes (#16)", () => {
  const settle = () => new Promise((r) => setTimeout(r, 450));

  function setup() {
    document.body.innerHTML = `<main><h1>ニュースレター</h1><form>
      <label>メール <input type="email" name="email" required></label>
      <label id="addr-label">住所 <input name="address"></label>
      <button type="submit">購読する</button></form></main>`;
    const registry = new ControlRegistry();
    registry.addFrom(document);
    const sent: string[] = [];
    const report = createReporter(document, registry, (m) => sent.push(m.type), undefined);
    report();
    const observer = watchForFormChanges(document, registry, report);
    return { sent, observer };
  }

  it.each<[string, () => void]>([
    ["heading text", () => (document.querySelector("h1")!.firstChild!.nodeValue = "資料請求")],
    ["required attribute", () => document.querySelector('[name="address"]')!.setAttribute("required", "")],
    ["label text", () => (document.getElementById("addr-label")!.firstChild!.nodeValue = "ご住所（任意）")],
    ["submit button text", () => (document.querySelector("button")!.textContent = "申し込む")],
  ])("%s", async (_name, change) => {
    const { sent, observer } = setup();
    change();
    await settle();
    observer.disconnect();
    expect(sent).toEqual(["observation", "observation"]);
  });

  it("unrelated DOM churn does not re-report", async () => {
    const { sent, observer } = setup();
    const ticker = document.createElement("div");
    document.body.append(ticker);
    ticker.textContent = "12:00:01";
    await settle();
    observer.disconnect();
    expect(sent).toEqual(["observation"]);
  });
});
