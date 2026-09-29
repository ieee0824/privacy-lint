import { describe, expect, it } from "vitest";
import { charsetOf } from "../src/background/document-fetcher";
import { OPERATOR_KEYWORDS, PRIVACY_KEYWORDS, extractExcerpts, htmlToBlocks } from "../src/background/document-text";

const POLICY = `<!doctype html><html><head><title>プライバシーポリシー | Sample</title>
<script>var leaked = "SCRIPT_SHOULD_NOT_APPEAR";</script><style>.x{}</style></head>
<body><nav>ホーム</nav>
<h2>1. 利用目的</h2><p>お客様の個人情報は、商品の発送およびお問い合わせへの回答のために利用します。</p>
<h2>2. 第三者提供</h2><p>法令に基づく場合を除き、第三者に提供しません。</p>
<p>お問い合わせ窓口: privacy@sample.example / 03-1234-5678</p>
<!-- comment SECRET -->
<p>2023年4月1日 改定</p>
<p>&copy; 2014 Sample Inc.</p>
</body></html>`;

describe("htmlToBlocks / extractExcerpts", () => {
  it("drops scripts, styles and comments", () => {
    const doc = htmlToBlocks(POLICY);
    expect(doc.title).toBe("プライバシーポリシー | Sample");
    const all = doc.blocks.join("\n");
    expect(all).not.toContain("SCRIPT_SHOULD_NOT_APPEAR");
    expect(all).not.toContain("SECRET");
  });

  it("extracts short, sanitized keyword excerpts and dated statements", () => {
    const excerpts = extractExcerpts(htmlToBlocks(POLICY), PRIVACY_KEYWORDS);
    expect(excerpts.some((e) => e.includes("利用目的") && e.includes("商品の発送"))).toBe(true);
    expect(excerpts.some((e) => e.includes("第三者提供"))).toBe(true);
    expect(excerpts.join()).toContain("[email]");
    expect(excerpts.join()).not.toMatch(/privacy@|1234-5678/);
    expect(excerpts).toContain("2023年4月1日 改定");
    expect(excerpts.every((e) => Array.from(e).length <= 280)).toBe(true);
  });

  it("finds operator statements", () => {
    const doc = htmlToBlocks("<dl><dt>販売業者</dt><dd>株式会社サンプル</dd><dt>所在地</dt><dd>東京都港区1-2-3</dd></dl>");
    const excerpts = extractExcerpts(doc, OPERATOR_KEYWORDS);
    expect(excerpts.join(" ")).toContain("株式会社サンプル");
  });

  it("does not execute or interpret markup", () => {
    const doc = htmlToBlocks(`<p>&lt;img src=x onerror=alert(1)&gt; 利用目的</p>`);
    expect(doc.blocks[0]).toBe("<img src=x onerror=alert(1)> 利用目的");
  });
});

describe("charsetOf", () => {
  it("prefers the header, falls back to meta", () => {
    const head = new TextEncoder().encode('<meta charset="Shift_JIS">');
    expect(charsetOf("text/html; charset=EUC-JP", head)).toBe("euc-jp");
    expect(charsetOf("text/html", head)).toBe("shift_jis");
    expect(charsetOf(null, new Uint8Array())).toBe("utf-8");
  });
});
