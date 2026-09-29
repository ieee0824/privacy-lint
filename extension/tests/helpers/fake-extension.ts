/**
 * In-memory stand-in for the WebExtension APIs used by the background modules.
 * It mutates the same `chrome` object that src/shared/browser.ts captured at import time.
 */
type Store = Map<string, unknown>;

function area(store: Store) {
  return {
    async get(keys: string | string[] | null) {
      const list = keys === null ? Array.from(store.keys()) : Array.isArray(keys) ? keys : [keys];
      const out: Record<string, unknown> = {};
      for (const k of list) if (store.has(k)) out[k] = structuredClone(store.get(k));
      return out;
    },
    async set(items: Record<string, unknown>) {
      for (const [k, v] of Object.entries(items)) store.set(k, structuredClone(v));
    },
    async remove(keys: string | string[]) {
      for (const k of Array.isArray(keys) ? keys : [keys]) store.delete(k);
    },
  };
}

export interface FakeExtension {
  local: Store;
  session: Store;
  badges: Map<number, string>;
  notices: number[];
}

export function installFakeExtension(): FakeExtension {
  const fake: FakeExtension = { local: new Map(), session: new Map(), badges: new Map(), notices: [] };
  const api = (globalThis as unknown as { chrome: Record<string, unknown> }).chrome;
  Object.assign(api, {
    storage: { local: area(fake.local), session: area(fake.session) },
    action: {
      async setBadgeText({ tabId, text }: { tabId: number; text: string }) {
        fake.badges.set(tabId, text);
      },
      async setBadgeBackgroundColor() {},
    },
    tabs: {
      async sendMessage(tabId: number) {
        fake.notices.push(tabId);
      },
    },
  });
  return fake;
}
