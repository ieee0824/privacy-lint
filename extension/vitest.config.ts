import { defineConfig } from "vitest/config";

export default defineConfig({
  define: {
    __RELAY_URL__: JSON.stringify("http://127.0.0.1:8787"),
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    setupFiles: ["tests/setup.ts"],
  },
});
