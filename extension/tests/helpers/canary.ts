/** Canary values from DESIGN.md §31.1. None of them may ever appear in extension output. */
export const CANARIES = [
  "山田太郎",
  "taro@example.com",
  "4111111111111111",
  "4111 1111 1111 1111",
  "super-secret-password",
  "090-9876-5432",
  "東京都千代田区千代田1-1",
  "1985-04-01",
];

export function expectNoCanary(payload: unknown, extra: string[] = []): void {
  const text = typeof payload === "string" ? payload : JSON.stringify(payload);
  for (const canary of [...CANARIES, ...extra]) {
    if (text.includes(canary)) throw new Error(`canary leaked: ${canary}`);
  }
}

/**
 * Makes any read of a form control's value state throw.
 * Returns a restore function.
 */
export function trapValueAccess(win: Window & typeof globalThis): () => void {
  const restores: Array<() => void> = [];
  const protos = [win.HTMLInputElement.prototype, win.HTMLTextAreaElement.prototype, win.HTMLSelectElement.prototype];
  const props = ["value", "valueAsDate", "valueAsNumber", "checked", "selectedIndex", "selectedOptions", "files", "defaultValue"];
  for (const proto of protos) {
    for (const prop of props) {
      const desc = Object.getOwnPropertyDescriptor(proto, prop);
      if (!desc?.get) continue;
      Object.defineProperty(proto, prop, {
        ...desc,
        get() {
          throw new Error(`forbidden read of ${prop}`);
        },
      });
      restores.push(() => Object.defineProperty(proto, prop, desc));
    }
  }
  const origGetAttribute = win.Element.prototype.getAttribute;
  win.Element.prototype.getAttribute = function (this: Element, name: string) {
    if (name.toLowerCase() === "value" && /^(INPUT|TEXTAREA|SELECT|OPTION)$/.test(this.tagName)) {
      throw new Error("forbidden read of value attribute");
    }
    return origGetAttribute.call(this, name);
  };
  restores.push(() => {
    win.Element.prototype.getAttribute = origGetAttribute;
  });
  const OrigFormData = win.FormData;
  (win as unknown as { FormData: unknown }).FormData = function () {
    throw new Error("forbidden FormData");
  };
  restores.push(() => {
    (win as unknown as { FormData: unknown }).FormData = OrigFormData;
  });
  return () => restores.reverse().forEach((r) => r());
}
