import { describe, expect, it } from "vitest";
import { effectiveBackend, isComplete } from "./result";

describe("effectiveBackend", () => {
  it("keeps wasm-mt when wllama really runs multi-threaded", () => {
    expect(effectiveBackend("wasm-mt", true)).toBe("wasm-mt");
  });

  it("relabels wasm-mt as wasm-st when wllama fell back to one thread", () => {
    expect(effectiveBackend("wasm-mt", false)).toBe("wasm-st");
  });

  it("leaves webgpu and wasm-st unchanged", () => {
    expect(effectiveBackend("webgpu", false)).toBe("webgpu");
    expect(effectiveBackend("wasm-st", false)).toBe("wasm-st");
  });
});

describe("isComplete", () => {
  const ok = { status: "ok" as const };
  const run = {};

  it("is complete when every selected cell loaded and ran", () => {
    expect(isComplete({ loads: [ok, ok], runs: [run] })).toBe(true);
  });

  it("is incomplete with zero runs (nothing selected, or everything skipped)", () => {
    expect(isComplete({ loads: [], runs: [] })).toBe(false);
    expect(isComplete({ loads: [{ status: "skipped" as const }], runs: [] })).toBe(false);
  });

  it("is incomplete when any selected cell was skipped, even if others ran", () => {
    expect(isComplete({ loads: [ok, { status: "skipped" as const }], runs: [run] })).toBe(false);
  });

  it("is incomplete on load errors, inference errors or a fatal error", () => {
    expect(isComplete({ loads: [ok, { status: "error" as const }], runs: [run] })).toBe(false);
    expect(
      isComplete({ loads: [{ status: "ok" as const, inferenceError: "OOM" }], runs: [run] }),
    ).toBe(false);
    expect(isComplete({ loads: [ok], runs: [run], fatal: "boom" })).toBe(false);
  });

  it("is incomplete when a cell crashed the tab (#108)", () => {
    expect(isComplete({ loads: [ok, { status: "crashed" as const }], runs: [run] })).toBe(false);
  });
});
