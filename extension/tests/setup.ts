// Minimal WebExtension global so modules importing shared/browser.ts load under Node.
(globalThis as unknown as { chrome: unknown }).chrome ??= {};
