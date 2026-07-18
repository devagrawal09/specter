import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 15_000,
    hookTimeout: 15_000,
    coverage: { reporter: ["text", "json-summary"] }
  }
});
