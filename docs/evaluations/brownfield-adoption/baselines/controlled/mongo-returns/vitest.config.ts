import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    sequence: { concurrent: false },
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
