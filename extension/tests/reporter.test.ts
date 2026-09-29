// @vitest-environment jsdom
/**
 * #14: the content script tells the background when the reported form disappears.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { ControlRegistry } from "../src/content/control-registry";
import { createReporter } from "../src/content/reporter";
import type { ContentMessage } from "../src/shared/messages";

const FORM = `<form id="f" method="post"><label>氏名 <input name="name"></label><label>メール <input type="email" name="email"></label></form>`;

let sent: ContentMessage["type"][];
let registry: ControlRegistry;
let report: () => void;

beforeEach(() => {
  history.replaceState(null, "", "/signup");
  document.body.innerHTML = FORM;
  sent = [];
  registry = new ControlRegistry();
  registry.addFrom(document);
  report = createReporter(document, registry, (m) => sent.push(m.type), undefined);
});

describe("reporter", () => {
  it("reports a form once, then form-gone once when it is removed", () => {
    report();
    report();
    expect(sent).toEqual(["observation"]);

    document.getElementById("f")!.remove();
    report();
    report();
    expect(sent).toEqual(["observation", "form-gone"]);
  });

  it("reports again when the form comes back", () => {
    report();
    document.getElementById("f")!.remove();
    report();
    document.body.innerHTML = FORM;
    registry.addFrom(document);
    report();
    expect(sent).toEqual(["observation", "form-gone", "observation"]);
  });

  it("never sends form-gone for a page that had no form", () => {
    document.body.innerHTML = `<p>記事</p>`;
    report();
    expect(sent).toEqual([]);
  });

  it("SPA navigation: re-reports the same form on a new URL, and clears when the new route has none", () => {
    report();
    history.pushState(null, "", "/signup/confirm");
    report();
    expect(sent).toEqual(["observation", "observation"]);

    history.pushState(null, "", "/articles");
    document.getElementById("f")!.remove();
    report();
    expect(sent).toEqual(["observation", "observation", "form-gone"]);
  });
});
