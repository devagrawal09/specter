import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("fixed public listener", () => {
  it("accepts only port 42133", () => {
    expect(loadConfig({ PORT: "42133" }).port).toBe(42133);
    expect(() => loadConfig({ PORT: "42134" })).toThrow();
  });
});
