/**
 * Firefox exposes the promise-based `browser` namespace, Chrome exposes `chrome`.
 * In Manifest V3 both return promises, so a single typed handle is enough (DESIGN.md §42.2).
 */
export const ext: typeof chrome =
  (globalThis as unknown as { browser?: typeof chrome }).browser ?? chrome;
