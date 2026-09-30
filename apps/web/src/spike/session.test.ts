import { describe, expect, it } from "vitest";
import {
  SESSION_KEY,
  beginCell,
  cellKey,
  clearSession,
  finishCell,
  loadSession,
  pendingCells,
  recoverCrash,
  saveSession,
  setStage,
  type Store,
} from "./session";

function memoryStore(initial: Record<string, string> = {}): Store & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      data.set(k, v);
    },
    removeItem: (k) => {
      data.delete(k);
    },
  };
}

const T0 = "2026-09-30T08:34:00.000Z";

describe("spike session persistence (#108)", () => {
  it("starts empty, and treats corrupt storage as empty rather than crashing", () => {
    expect(loadSession(memoryStore(), T0)).toMatchObject({
      loads: [],
      runs: [],
      done: [],
      attempt: null,
    });
    expect(loadSession(memoryStore({ [SESSION_KEY]: "{not json" }), T0).loads).toEqual([]);
  });

  it("round-trips through storage", () => {
    const store = memoryStore();
    const s = loadSession(store, T0);
    s.runs.push({ model: "m", wallMs: 1 });
    expect(saveSession(store, s)).toBe(true);
    expect(loadSession(store, T0).runs).toEqual([{ model: "m", wallMs: 1 }]);
  });

  it("reports a failed save (quota, private mode) instead of throwing", () => {
    const full: Store = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => undefined,
    };
    expect(saveSession(full, loadSession(full, T0))).toBe(false);
  });

  it("an attempt left open by a killed tab becomes a crashed load at the stage it died", () => {
    const store = memoryStore();
    const s = beginCell(loadSession(store, T0), "gemma3-270m-q8_0", "webgpu", T0);
    saveSession(store, s);
    // ...tab killed here; page reloads...
    const { session, crashed } = recoverCrash(loadSession(store, T0));
    expect(crashed).toMatchObject({ model: "gemma3-270m-q8_0", backend: "webgpu", stage: "load" });
    expect(session.attempt).toBeNull();
    expect(session.done).toContain(cellKey("gemma3-270m-q8_0", "webgpu"));
    expect(session.loads).toEqual([
      expect.objectContaining({
        model: "gemma3-270m-q8_0",
        backend: "webgpu",
        requestedBackend: "webgpu",
        status: "crashed",
        stage: "load",
      }),
    ]);
  });

  it("records the inference stage when the tab dies after the model loaded", () => {
    let s = beginCell(loadSession(memoryStore(), T0), "m", "wasm-mt", T0);
    s = setStage(s, "inference");
    expect(recoverCrash(s).crashed?.stage).toBe("inference");
  });

  it("no open attempt means nothing to recover", () => {
    const s = loadSession(memoryStore(), T0);
    expect(recoverCrash(s)).toEqual({ session: s, crashed: null });
  });

  it("finishing a cell closes the attempt and marks it done", () => {
    const s = finishCell(beginCell(loadSession(memoryStore(), T0), "m", "webgpu", T0));
    expect(s.attempt).toBeNull();
    expect(s.done).toEqual([cellKey("m", "webgpu")]);
    expect(recoverCrash(s).crashed).toBeNull();
  });

  it("pending cells skip finished and crashed ones, keeping matrix order", () => {
    const cells = [
      { model: "a", backend: "webgpu" as const },
      { model: "a", backend: "wasm-mt" as const },
      { model: "b", backend: "webgpu" as const },
    ];
    let s = finishCell(beginCell(loadSession(memoryStore(), T0), "a", "webgpu", T0));
    s = beginCell(s, "a", "wasm-mt", T0);
    s = recoverCrash(s).session;
    expect(pendingCells(s, cells)).toEqual([{ model: "b", backend: "webgpu" }]);
  });

  it("clearing removes everything so the next run starts over", () => {
    const store = memoryStore();
    saveSession(store, finishCell(beginCell(loadSession(store, T0), "a", "webgpu", T0)));
    clearSession(store);
    expect(store.data.has(SESSION_KEY)).toBe(false);
    expect(loadSession(store, T0).done).toEqual([]);
  });
});

describe("crash attribution (review on #109)", () => {
  it("an inference crash is attributed to the backend that actually ran", () => {
    // wasm-mt requested, but wllama fell back to one thread before the tab died
    let s = beginCell(loadSession(memoryStore(), T0), "m", "wasm-mt", T0);
    s = setStage(s, "inference", "wasm-st");
    const { session, crashed } = recoverCrash(s);
    expect(crashed).toMatchObject({ backend: "wasm-st", requestedBackend: "wasm-mt" });
    // the matrix is keyed by what was requested, so Run still skips this cell
    expect(session.done).toEqual([cellKey("m", "wasm-mt")]);
  });

  it("a load crash (effective backend not yet known) keeps the requested one", () => {
    const s = beginCell(loadSession(memoryStore(), T0), "m", "wasm-mt", T0);
    expect(recoverCrash(s).crashed).toMatchObject({
      backend: "wasm-mt",
      requestedBackend: "wasm-mt",
    });
  });
});
