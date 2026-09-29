// Result-labeling rules for the #66 spike, kept pure so they're testable.

export type Backend = "webgpu" | "wasm-mt" | "wasm-st";

/**
 * The backend a run *actually* used. wllama silently falls back to one thread
 * when the page isn't cross-origin isolated, so a requested "wasm-mt" cell can
 * really be single-threaded — label it by what ran, not what was asked for.
 */
export function effectiveBackend(requested: Backend, isMultithread: boolean): Backend {
  return requested === "wasm-mt" && !isMultithread ? "wasm-st" : requested;
}

interface LoadOutcome {
  status: "ok" | "skipped" | "error";
  inferenceError?: string;
}

/** Complete = at least one run, and every selected cell loaded and ran without error. */
export function isComplete(result: {
  loads: LoadOutcome[];
  runs: unknown[];
  fatal?: string;
}): boolean {
  return (
    result.fatal === undefined &&
    result.runs.length > 0 &&
    result.loads.length > 0 &&
    result.loads.every((l) => l.status === "ok" && !l.inferenceError)
  );
}
