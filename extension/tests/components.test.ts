import { describe, expect, it } from "vitest";
import { COMPONENTS, LIFECYCLE_DATA_AS_OF, lifecycleOf, unsupportedComponents } from "../src/risk/component-lifecycle";
import {
  componentFromGenerator,
  componentFromUrl,
  componentsFromHeaders,
  dedupeComponents,
} from "../src/shared/component-patterns";

describe("componentFromUrl", () => {
  it.each([
    ["https://code.jquery.com/jquery-1.8.3.min.js", { id: "jquery", version: "1.8.3" }],
    ["https://example.jp/js/jquery.1.4.2.js", { id: "jquery", version: "1.4.2" }],
    ["https://example.jp/js/jquery-3.7.1.slim.min.js", { id: "jquery", version: "3.7.1" }],
    ["https://cdnjs.cloudflare.com/ajax/libs/jquery/2.2.4/jquery.min.js", { id: "jquery", version: "2.2.4" }],
    ["https://cdn.jsdelivr.net/npm/bootstrap@3.3.7/dist/css/bootstrap.min.css", { id: "bootstrap", version: "3.3.7" }],
    ["https://maxcdn.bootstrapcdn.com/bootstrap/4.0.0/js/bootstrap.min.js", { id: "bootstrap", version: "4.0.0" }],
    ["https://ajax.googleapis.com/ajax/libs/angularjs/1.5.8/angular.min.js", { id: "angularjs", version: "1.5.8" }],
    ["https://unpkg.com/vue@2.6.14/dist/vue.js", { id: "vue", version: "2.6.14" }],
    ["https://example.jp/wp-includes/js/wp-embed.min.js?ver=4.9.8", { id: "wordpress", version: "4.9.8" }],
  ])("%s", (url, expected) => {
    expect(componentFromUrl(url)).toEqual(expected);
  });

  it("returns only the component and version, never other URL parts", () => {
    const c = componentFromUrl("https://example.jp/wp-includes/js/a.js?session=SECRET123&ver=4.0.1&uid=42");
    expect(c).toEqual({ id: "wordpress", version: "4.0.1" });
    expect(JSON.stringify(c)).not.toMatch(/SECRET|uid|example/);
  });

  it("ignores plugin/theme ?ver= and unrelated files", () => {
    expect(componentFromUrl("https://example.jp/wp-content/plugins/x/x.js?ver=1.0")).toBeNull();
    expect(componentFromUrl("https://example.jp/js/app-1.2.3.js")).toBeNull();
    expect(componentFromUrl("javascript:alert(1)")).toBeNull();
    expect(componentFromUrl("not a url")).toBeNull();
  });
});

describe("componentFromGenerator / componentsFromHeaders", () => {
  it("parses generators", () => {
    expect(componentFromGenerator("WordPress 5.2.4")).toEqual({ id: "wordpress", version: "5.2.4" });
    expect(componentFromGenerator("Drupal 7 (https://www.drupal.org)")).toEqual({ id: "drupal", version: "7" });
    expect(componentFromGenerator("Hugo 0.120.0")).toBeNull();
  });

  it("parses Server and X-Powered-By", () => {
    expect(componentsFromHeaders("Apache/2.2.15 (CentOS)", "PHP/5.3.3")).toEqual([
      { id: "apache", version: "2.2.15" },
      { id: "php", version: "5.3.3" },
    ]);
    expect(componentsFromHeaders("Microsoft-IIS/7.5", "ASP.NET")).toEqual([{ id: "iis", version: "7.5" }]);
    expect(componentsFromHeaders("nginx", null)).toEqual([]);
  });

  it("dedupes and rejects non-numeric versions", () => {
    expect(
      dedupeComponents(
        [
          { id: "jquery", version: "1.8.3" },
          { id: "jquery", version: "1.8.3" },
          { id: "php", version: "5.x<script>" },
        ],
        10,
      ),
    ).toEqual([{ id: "jquery", version: "1.8.3" }]);
  });
});

describe("lifecycle table", () => {
  const NOW = Date.parse("2026-09-30T00:00:00Z");

  it("records when it was reviewed", () => {
    expect(LIFECYCLE_DATA_AS_OF).toMatch(/^\d{4}-\d{2}$/);
  });

  it("uses the longest matching release line", () => {
    expect(lifecycleOf({ id: "php", version: "7.4.33" }, NOW)?.line).toBe("7.4");
    expect(lifecycleOf({ id: "php", version: "5.6.40" }, NOW)?.line).toBe("5");
    expect(lifecycleOf({ id: "jquery", version: "1.12.4" }, NOW)?.line).toBe("1");
  });

  it("does not match across version boundaries", () => {
    expect(lifecycleOf({ id: "php", version: "7.40.0" }, NOW)).toBeNull();
    expect(lifecycleOf({ id: "jquery", version: "10.0.0" }, NOW)).toBeNull();
  });

  it("treats unlisted lines as unknown, not as unsupported", () => {
    expect(lifecycleOf({ id: "jquery", version: "3.7.1" }, NOW)).toBeNull();
    expect(unsupportedComponents([{ id: "wordpress", version: "6.6.2" }], NOW)).toEqual([]);
  });

  it("a line whose end date is in the future is not unsupported yet", () => {
    expect(unsupportedComponents([{ id: "php", version: "8.2.10" }], NOW)).toEqual([]);
    expect(unsupportedComponents([{ id: "php", version: "8.2.10" }], Date.parse("2027-02-01T00:00:00Z"))).toHaveLength(1);
  });

  it("sorts by how long support has been over", () => {
    const out = unsupportedComponents(
      [
        { id: "vue", version: "2.7.16" },
        { id: "apache", version: "2.2.34" },
      ],
      NOW,
    );
    expect(out.map((s) => s.id)).toEqual(["apache", "vue"]);
  });

  it("has well-formed dates", () => {
    for (const c of Object.values(COMPONENTS)) {
      for (const l of c.lines) expect(Number.isNaN(Date.parse(l.endOfSupport))).toBe(false);
    }
  });
});
