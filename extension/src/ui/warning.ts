/**
 * Non-blocking in-page notice shown when the user starts entering data into a
 * sensitive field on a page assessed at CAUTION or above (DESIGN.md §10.2).
 *
 * Rendered inside a closed shadow root with textContent only; the page's
 * styles and scripts cannot restyle it or read its content through the DOM.
 * It never takes focus and never blocks input.
 */
import type { Assessment } from "../shared/assessment";
import { DISCLAIMER, findingIcon, findingText, headline } from "../risk/findings";

const HOST_ID = "privacy-lint-notice-host";
const AUTO_HIDE_MS = 15000;

const STYLE = `
  :host { all: initial; }
  .box {
    position: fixed; right: 16px; bottom: 16px; z-index: 2147483647;
    max-width: 360px; box-sizing: border-box; padding: 12px 14px;
    font: 13px/1.5 system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif;
    color: #1f2328; background: #fffbea; border: 1px solid #d4a72c; border-radius: 8px;
    box-shadow: 0 4px 16px rgba(0,0,0,.18);
  }
  @media (prefers-color-scheme: dark) {
    .box { color: #e6edf3; background: #2b2410; border-color: #9e7b1a; }
  }
  .title { font-weight: 600; margin: 0 24px 4px 0; }
  ul { margin: 4px 0; padding-left: 0; list-style: none; }
  li { margin: 2px 0; }
  .note { font-size: 11px; opacity: .75; margin-top: 6px; }
  button {
    position: absolute; top: 6px; right: 8px; border: 0; background: transparent;
    color: inherit; font-size: 16px; cursor: pointer; line-height: 1;
  }
`;

export function showNotice(doc: Document, assessment: Assessment): void {
  doc.getElementById(HOST_ID)?.remove();

  const host = doc.createElement("div");
  host.id = HOST_ID;
  const shadow = host.attachShadow({ mode: "closed" });

  const style = doc.createElement("style");
  style.textContent = STYLE;
  const box = doc.createElement("div");
  box.className = "box";
  box.setAttribute("role", "status");

  const title = doc.createElement("p");
  title.className = "title";
  title.textContent = `Privacy Lint: ${headline(assessment.state, assessment.level)}`;
  box.append(title);

  const list = doc.createElement("ul");
  for (const finding of assessment.findings.filter((f) => f.severity === "warn").slice(0, 3)) {
    const li = doc.createElement("li");
    li.textContent = `${findingIcon(finding)} ${findingText(finding)}`;
    list.append(li);
  }
  box.append(list);

  const note = doc.createElement("p");
  note.className = "note";
  note.textContent = `詳細はツールバーの Privacy Lint アイコンから確認できます。${DISCLAIMER}`;
  box.append(note);

  const close = doc.createElement("button");
  close.type = "button";
  close.tabIndex = -1;
  close.setAttribute("aria-label", "閉じる");
  close.textContent = "×";
  close.addEventListener("click", () => host.remove());
  box.append(close);

  shadow.append(style, box);
  (doc.body ?? doc.documentElement).append(host);
  setTimeout(() => host.remove(), AUTO_HIDE_MS);
}
