import { describe, expect, it } from "vitest";
import { MODELS } from "./models";

describe("spike model catalogue (#110)", () => {
  it("has unique ids and GGUF files from Hugging Face repos", () => {
    const ids = MODELS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const m of MODELS) {
      expect(m.file).toMatch(/\.gguf$/);
      expect(m.repo).toMatch(/^[\w.-]+\/[\w.-]+$/);
      expect(m.sizeMB).toBeGreaterThan(0);
    }
  });

  it("includes the small candidates and defaults to the ones not yet measured on phones", () => {
    expect(MODELS.map((m) => m.id)).toEqual(
      expect.arrayContaining(["lfm2-350m-extract-q8_0", "smollm2-135m-q8_0"]),
    );
    const defaults = MODELS.filter((m) => m.defaultOn).map((m) => m.id);
    expect(defaults).toEqual(["gemma3-270m-q8_0", "lfm2-350m-extract-q8_0", "smollm2-135m-q8_0"]);
  });
});
