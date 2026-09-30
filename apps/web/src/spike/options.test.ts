import { describe, expect, it } from "vitest";
import { parseOptions, wasmCaps } from "./options";

describe("parseOptions (#110 URL overrides)", () => {
  it("defaults: default build, auto threads, 2048 context", () => {
    expect(parseOptions("")).toEqual({ compat: false, threads: null, ctx: 2048 });
  });

  it("reads compat, threads and ctx", () => {
    expect(parseOptions("?compat=1&threads=1&ctx=512")).toEqual({
      compat: true,
      threads: 1,
      ctx: 512,
    });
  });

  it("ignores out-of-range or malformed values instead of passing them to llama.cpp", () => {
    expect(parseOptions("?compat=yes&threads=0&ctx=99")).toEqual({
      compat: false,
      threads: null,
      ctx: 2048,
    });
    expect(parseOptions("?threads=64&ctx=100000")).toEqual({
      compat: false,
      threads: null,
      ctx: 2048,
    });
    expect(parseOptions("?threads=2.5&ctx=abc").threads).toBeNull();
  });
});

describe("wasmCaps", () => {
  it("reports JSPI and Memory64 support", () => {
    const withBoth = {
      Suspending: function Suspending() {},
      Memory: function Memory(d: { address?: string }) {
        if (d.address !== "i64") throw new TypeError("no mem64");
      },
    };
    expect(wasmCaps(withBoth)).toEqual({ jspi: true, mem64: true });
    const neither = {
      Memory: function Memory() {
        throw new TypeError("no mem64");
      },
    };
    expect(wasmCaps(neither)).toEqual({ jspi: false, mem64: false });
  });
});
