import { describe, expect, it } from "vitest";
import { passesLuhn, sanitizeText } from "../src/privacy/sanitizer";
import { classifyPath, isOrigin, stripUrl } from "../src/privacy/url-sanitizer";

describe("sanitizeText", () => {
  it("redacts identifiers but keeps surrounding text", () => {
    const out = sanitizeText(
      "連絡先: taro@example.com / TEL 03-1234-5678 / card 4111 1111 1111 1111 / token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.abcdefghij",
      500,
    );
    expect(out).toContain("[email]");
    expect(out).toContain("[phone]");
    expect(out).toContain("[card]");
    expect(out).toContain("[token]");
    expect(out).not.toMatch(/taro@|1234-5678|4111|eyJ/);
  });

  it("normalizes full-width digits before matching", () => {
    expect(sanitizeText("電話 ０３−１２３４−５６７８", 100)).toContain("[phone]");
  });

  it("keeps short numbers such as years and postal codes", () => {
    expect(sanitizeText("2024年4月1日改定 〒100-0001", 100)).toBe("2024年4月1日改定 〒100-0001");
  });

  it("drops URLs entirely (query strings may carry secrets)", () => {
    expect(sanitizeText("see https://example.com/reset?token=SECRET", 100)).toBe("see [url]");
  });

  it("redacts long mixed tokens and hex ids", () => {
    expect(sanitizeText("session a1b2c3d4e5f6a7b8c9d0e1f2a3b4", 100)).toBe("session [token]");
  });

  it("truncates by code points", () => {
    expect(Array.from(sanitizeText("あ".repeat(50), 10))).toHaveLength(10);
  });

  it("luhn", () => {
    expect(passesLuhn("4111111111111111")).toBe(true);
    expect(passesLuhn("4111111111111112")).toBe(false);
  });
});

describe("url helpers", () => {
  it("strips query and fragment", () => {
    expect(stripUrl("https://example.com/privacy?session=abc#top")).toBe("https://example.com/privacy");
    expect(stripUrl("/privacy?x=1", "https://example.com/a/b")).toBe("https://example.com/privacy");
    expect(stripUrl("javascript:alert(1)")).toBeNull();
    expect(stripUrl("mailto:a@example.com")).toBeNull();
  });

  it("classifies paths coarsely", () => {
    expect(classifyPath("/shop/checkout")).toBe("checkout");
    expect(classifyPath("/%E4%BA%88%E7%B4%84")).toBe("reservation");
    expect(classifyPath("/newsletter/subscribe")).toBe("newsletter");
    expect(classifyPath("/users/12345")).toBe("other");
  });

  it("recognizes origins only", () => {
    expect(isOrigin("https://example.com")).toBe(true);
    expect(isOrigin("http://localhost:8080")).toBe(true);
    expect(isOrigin("https://example.com/path")).toBe(false);
    expect(isOrigin("https://example.com?x")).toBe(false);
  });
});
