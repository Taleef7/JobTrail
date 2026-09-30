// URL overrides and runtime capability checks for the spike (#110), kept pure so they're
// testable. Overrides let the iPhone test crash hypotheses without a redeploy:
//   ?compat=1   force wllama's 32-bit Asyncify build (no Memory64/JSPI code path)
//   ?threads=N  pin the thread count (1–16)
//   ?ctx=N      context size (256–8192)

export interface RunOptions {
  compat: boolean;
  threads: number | null;
  ctx: number;
}

const intIn = (raw: string | null, lo: number, hi: number): number | null => {
  if (raw === null || !/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return n >= lo && n <= hi ? n : null;
};

export function parseOptions(search: string): RunOptions {
  const q = new URLSearchParams(search);
  return {
    compat: q.get("compat") === "1",
    threads: intIn(q.get("threads"), 1, 16),
    ctx: intIn(q.get("ctx"), 256, 8192) ?? 2048,
  };
}

interface WasmLike {
  Suspending?: unknown;
  Memory: new (descriptor: { initial: bigint; address: string }) => unknown;
}

/** JSPI and Memory64 decide which wllama build runs (both → default 64-bit build). */
export function wasmCaps(wasm: unknown): { jspi: boolean; mem64: boolean } {
  const w = wasm as WasmLike;
  const mem64 = (() => {
    try {
      new w.Memory({ initial: 1n, address: "i64" });
      return true;
    } catch {
      return false;
    }
  })();
  return { jspi: typeof w.Suspending === "function", mem64 };
}
