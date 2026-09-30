// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildRequest, evaluate } from "../src/background/assessment";
import { DEFAULT_SETTINGS } from "../src/background/settings";
import { ControlRegistry } from "../src/content/control-registry";
import { authorText, editableFromAttributes } from "../src/content/dom-text";
import { firstLabel, isSubmitter } from "../src/content/form-scanner";
import { decideMutation, watchForFormChanges, type MutationFacts } from "../src/content/mutation-observer";
import { buildObservation } from "../src/content/page-observer";
import { createReporter, initialReporterState, transitionReporter } from "../src/content/reporter";
import { watchResourceChanges } from "../src/content/resource-observer";
import { installFocusTrigger, transitionFocus } from "../src/content/ui-trigger";
import type { ContentMessage } from "../src/shared/messages";
import { observationSignature } from "../src/shared/signature";
import { clearNotice, showNotice } from "../src/ui/warning";
import { trapValueAccess } from "./helpers/canary";

const PERF = { getEntriesByType: () => [] };
const observers: MutationObserver[] = [];
let restore = () => {};
beforeEach(() => {
  document.body.innerHTML = "";
  history.replaceState(null, "", "/signup");
});
afterEach(() => {
  observers.forEach(observer => observer.disconnect());
  observers.length = 0;
  restore();
  vi.useRealTimers();
});
const settle = async () => { await Promise.resolve(); await vi.advanceTimersByTimeAsync(450); };
const unusedFetch: typeof fetch = async () => { throw Error("unexpected fetch"); };

function setup(html: string) {
  document.body.innerHTML = html;
  const registry = new ControlRegistry();
  registry.addFrom(document);
  const sent: ContentMessage[] = [];
  const report = createReporter(document, registry, m => sent.push(m), PERF);
  report();
  return { registry, sent, report };
}

describe("editable text privacy (#20)", () => {
  it.each([
    '<h1 contenteditable="true">CANARY氏名</h1>',
    '<div contenteditable="true"><h1>CANARY氏名</h1></div>',
    '<div contenteditable="plaintext-only"><section><h1>CANARY氏名</h1></section></div>',
  ])("excludes editable headings through request construction", async html => {
    const { registry } = setup(`${html}<form><input type="email"></form>`);
    const { request } = await buildRequest(buildObservation(document, registry, PERF)!, false, unusedFetch);
    expect(JSON.stringify(request)).not.toContain("CANARY");
  });

  it("does not read text nodes of inherited editable labels", () => {
    const { registry } = setup('<form><div contenteditable="true"><label>CANARY氏名<input type="email"></label></div></form>');
    const node = document.querySelector("label")!.firstChild!;
    Object.defineProperty(node, "nodeValue", { get() { throw Error("editable text read"); } });
    expect(buildObservation(document, registry, PERF)!.form.fields[0]?.label).toBeUndefined();
    registry.refresh();
  });

  it("honors false and invalid inherited editable attributes", () => {
    document.body.innerHTML = '<div contenteditable="true"><h1 contenteditable="FALSE">作者の見出し</h1></div>';
    expect(authorText(document.querySelector("h1")!, 120)).toBe("作者の見出し");
    const attrs = Object.freeze(["invalid", null, "plaintext-only"]);
    expect(editableFromAttributes(attrs)).toBe(true);
    expect(editableFromAttributes(attrs)).toBe(true);
    expect(attrs).toEqual(["invalid", null, "plaintext-only"]);
  });
});

describe("submitter and label selection (#22, #35)", () => {
  it("ignores non-submit and disabled overrides and produces an HTTP finding", async () => {
    const { registry } = setup(`<form action="http://insecure.example/submit" method="post">
      <input type="email"><button type="button" formaction="https://secure.example/preview">Preview</button>
      <button disabled formaction="https://secure.example/disabled">Disabled</button><button>Submit</button></form>`);
    const observation = buildObservation(document, registry, PERF)!;
    expect(observation.form.actionScheme).toBe("http");
    const result = await evaluate(observation, { ...DEFAULT_SETTINGS, remoteEvaluation: false }, { fetchImpl: unusedFetch, now: () => 0 });
    expect(result.findings.map(f => f.id)).toContain("insecure_form_action");
  });

  it("keeps valid external submitter overrides", () => {
    const { registry } = setup('<form id="f" action="https://default.example"><input type="email"></form><button form="f" formaction="http://submit.example">Submit</button>');
    expect(buildObservation(document, registry, PERF)!.form.actionOrigin).toBe("http://submit.example");
    expect(isSubmitter("INPUT", "image", false)).toBe(true);
    expect(isSubmitter("INPUT", "text", false)).toBe(false);
  });

  it("selects label candidates in order without mutating them", () => {
    const candidates = Object.freeze([undefined, "", "aria-labelledby", "aria-label", "title", "table"]);
    expect(firstLabel(candidates)).toBe("aria-labelledby");
    expect(firstLabel(candidates)).toBe("aria-labelledby");
    expect(candidates).toEqual([undefined, "", "aria-labelledby", "aria-label", "title", "table"]);
  });
});

describe("dynamic classification and mutation plans (#24, #34)", () => {
  it.each(["hidden", "search"])("detects initially ignored %s controls", async type => {
    vi.useFakeTimers();
    const { registry, sent, report } = setup(`<form><input name="email" type="${type}"></form>`);
    observers.push(watchForFormChanges(document, registry, report));
    const input = document.querySelector("input")!;
    input.setAttribute("type", "email");
    await settle();
    expect(sent.map(m => m.type)).toEqual(["observation"]);
    expect(registry.kindOf(input)).toBe("email");
  });

  it("reports disappearing and restored controls and focus", async () => {
    vi.useFakeTimers();
    const { registry, sent, report } = setup('<form><input type="email"></form>');
    observers.push(watchForFormChanges(document, registry, report));
    const focused = vi.fn();
    installFocusTrigger(document, registry, focused);
    const input = document.querySelector("input")!;
    input.setAttribute("type", "hidden"); await settle();
    input.setAttribute("type", "email"); await settle();
    input.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    expect(sent.map(m => m.type)).toEqual(["observation", "form-gone", "observation"]);
    expect(focused).toHaveBeenCalledOnce();
  });

  it.each(["addedControl", "addedContext", "removed", "controlAttribute", "contextAttribute", "contextText"] as const)("plans %s independently", key => {
    const facts: MutationFacts = { type: "childList", addedControl: false, addedContext: false, removed: false,
      controlAttribute: false, contextAttribute: false, contextText: false, [key]: true };
    Object.freeze(facts);
    const first = decideMutation(facts);
    expect(first.report).toBe(true);
    expect(decideMutation(facts)).toEqual(first);
    expect(facts[key]).toBe(true);
  });
});

describe("active form and explicit reporting state (#23, #26, #44)", () => {
  it("reports the HTTP password form on focus without reading input values", () => {
    const { registry, sent, report } = setup(`<form action="https://safe.example"><input name="name"><input type="email"></form>
      <form action="http://password.example"><input type="password"></form>`);
    restore = trapValueAccess(window);
    installFocusTrigger(document, registry, control => report.focus(control));
    const passwordControl = document.querySelector('[type="password"]')!;
    passwordControl.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    passwordControl.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    const messages = sent.filter(m => m.type === "observation");
    expect(messages).toHaveLength(2);
    expect(messages[1]).toMatchObject({ focused: true, observation: { form: { actionScheme: "http", fields: [{ kind: "password" }] } } });
  });

  it("reports new identical forms on replacement and resets focus after form-gone", () => {
    const { registry, sent, report } = setup('<form><input type="email"></form>');
    const trigger = installFocusTrigger(document, registry, control => report.focus(control));
    document.querySelector("input")!.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    document.body.innerHTML = ""; report(); trigger.reset();
    document.body.innerHTML = '<form><input type="email"></form>'; registry.addFrom(document); report();
    document.querySelector("input")!.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    expect(sent.map(m => m.type)).toEqual(["observation", "observation", "form-gone", "observation", "observation"]);
    expect(sent.filter(m => m.type === "observation" && m.focused)).toHaveLength(2);
  });

  it("clears old notice immediately when switching forms", () => {
    document.body.innerHTML = '<form><input type="email"></form><form><input type="password"></form>';
    const registry = new ControlRegistry(); registry.addFrom(document);
    const report = createReporter(document, registry, () => {}, PERF, () => clearNotice(document));
    report();
    showNotice(document, { state: "evaluated", level: 2, findings: [], statuses: { operator: "confirmed", privacyPolicy: "found", formAction: "same_origin" }, sensitiveKinds: ["email"], assessedAt: 0 });
    expect(document.getElementById("privacy-lint-notice-host")).not.toBeNull();
    report.focus(document.querySelector('[type="password"]')!);
    expect(document.getElementById("privacy-lint-notice-host")).toBeNull();
  });

  it("reducer covers unchanged, changed, navigated, focused, and missing observations without mutation", () => {
    const { registry } = setup('<form><input type="email"></form>');
    const observation = buildObservation(document, registry, PERF)!;
    const initial = Object.freeze(initialReporterState());
    const event = Object.freeze({ href: document.URL, lifecycle: 1, observation, focused: false });
    const first = transitionReporter(initial, event);
    expect(transitionReporter(initial, event)).toEqual(first);
    expect(initial).toEqual(initialReporterState());
    expect(transitionReporter(first.state, event).message).toBeUndefined();
    expect(transitionReporter(first.state, { ...event, href: `${document.URL}#next` }).message?.type).toBe("observation");
    expect(transitionReporter(first.state, { ...event, focused: true }).message).toMatchObject({ type: "observation", focused: true });
    expect(transitionReporter(first.state, { ...event, observation: { ...observation, page: { ...observation.page, title: "changed" } } }).message?.type).toBe("observation");
    expect(transitionReporter(first.state, { ...event, lifecycle: null, observation: null }).message?.type).toBe("form-gone");
    const focusState = Object.freeze({ href: "", lifecycle: null });
    const focusEvent = Object.freeze({ href: "page", lifecycle: 1, kind: "email" as const });
    expect(transitionFocus(focusState, focusEvent)).toEqual(transitionFocus(focusState, focusEvent));
    expect(focusState).toEqual({ href: "", lifecycle: null });
    expect(transitionFocus({ href: "page", lifecycle: 1 }, focusEvent).notify).toBe(false);
  });
});

describe("resource changes (#27)", () => {
  it("manual refresh synchronously returns current resource facts before debounce", () => {
    const { sent, report } = setup('<form><input type="email"></form>');
    report.focus(document.querySelector("input")!);
    const oldSignature = report.signature();
    const script = document.createElement("script"); script.src = "https://fresh.example/code.js";
    document.body.append(script);
    const fresh = report.refresh();
    expect(fresh.focused).toBe(true);
    expect(fresh.observation?.resources).toContainEqual({ origin: "https://fresh.example", kind: "script" });
    expect(report.signature()).not.toBe(oldSignature);
    expect(sent).toHaveLength(2);
    document.body.innerHTML = "";
    expect(report.refresh()).toEqual({ observation: null, focused: false });
  });

  it("automatically reports 0 to 14 third-party scripts and retains equal summaries", async () => {
    vi.useFakeTimers();
    const { registry, sent, report } = setup('<form><input type="email"></form>');
    observers.push(watchForFormChanges(document, registry, report));
    const first = sent[0];
    for (let i = 0; i < 14; i++) {
      const script = document.createElement("script"); script.src = `https://tracker${i}.example/code.js`;
      document.body.append(script);
    }
    await settle();
    const second = sent[1];
    expect(second?.type).toBe("observation");
    if (first?.type !== "observation" || second?.type !== "observation") throw Error("missing observations");
    expect(second.observation.resources).toHaveLength(14);
    expect(observationSignature(second.observation)).not.toBe(observationSignature(first.observation));
    document.querySelector("script")!.setAttribute("src", "https://tracker0.example/new.js"); await settle();
    expect(sent).toHaveLength(2);
  });

  it("reports resource timing changes through a debounced PerformanceObserver", async () => {
    vi.useFakeTimers();
    const report = vi.fn(); let completed = () => {};
    const observe = vi.fn();
    class FakeObserver {
      constructor(callback: () => void) { completed = callback; }
      observe = observe;
      disconnect() {}
    }
    watchResourceChanges(report, FakeObserver as unknown as typeof PerformanceObserver);
    expect(observe).toHaveBeenCalledWith({ entryTypes: ["resource"] });
    completed(); completed(); await settle();
    expect(report).toHaveBeenCalledOnce();
  });
});
