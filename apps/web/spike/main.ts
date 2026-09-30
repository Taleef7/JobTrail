// Spike #66: measure wllama (llama.cpp → WASM/WebGPU) on real browsers.
// Vanilla DOM on purpose: this page is disposable and must not grow the main app.
import { Wllama } from "@wllama/wllama/esm/index.js";
import type { ResultTimings } from "@wllama/wllama/esm/types/oai-compat.js";
import wasmUrl from "@wllama/wllama/esm/wasm/wllama.wasm?url";
import "../src/styles.css";
import "./spike.css";
import {
  SPIKE_NOTES,
  SPIKE_SCHEMA,
  buildMessages,
  parseModelJson,
  validateSpikeExtraction,
} from "../src/spike/extraction";
import { effectiveBackend, isComplete, type Backend } from "../src/spike/result";
import {
  beginCell,
  clearSession,
  finishCell,
  loadSession,
  pendingCells,
  recoverCrash,
  saveSession,
  setStage,
  type CrashedLoad,
  type Session,
  type Store,
} from "../src/spike/session";

interface ModelSpec {
  id: string;
  repo: string;
  file: string;
  sizeMB: number;
}

const MODELS: ModelSpec[] = [
  {
    id: "gemma3-270m-q8_0",
    repo: "unsloth/gemma-3-270m-it-GGUF",
    file: "gemma-3-270m-it-Q8_0.gguf",
    sizeMB: 292,
  },
  {
    id: "gemma3-270m-q4_0",
    repo: "unsloth/gemma-3-270m-it-GGUF",
    file: "gemma-3-270m-it-Q4_0.gguf",
    sizeMB: 242,
  },
  {
    id: "qwen3-0.6b-q4_k_m",
    repo: "unsloth/Qwen3-0.6B-GGUF",
    file: "Qwen3-0.6B-Q4_K_M.gguf",
    sizeMB: 397,
  },
];

const BACKENDS: { id: Backend; label: string; defaultOn: boolean }[] = [
  { id: "webgpu", label: "WebGPU (all layers)", defaultOn: true },
  { id: "wasm-mt", label: "WASM multi-thread", defaultOn: true },
  { id: "wasm-st", label: "WASM single-thread (slow)", defaultOn: false },
];

interface RunRecord {
  model: string;
  backend: Backend;
  note: number;
  shape: "long" | "short";
  constrained: boolean;
  promptTokens: number | null;
  ttftMs: number | null;
  prefillMs: number | null;
  prefillTokPerSec: number | null;
  decodeTokens: number | null;
  decodeTokPerSec: number | null;
  wallMs: number;
  jsonOk: boolean;
  schemaErrors: string[];
  output: string;
}

interface LoadRecord {
  model: string;
  /** What actually ran (wasm-mt that fell back to one thread is recorded as wasm-st). */
  backend: Backend;
  requestedBackend: Backend;
  loadMs: number;
  /** Download-progress events seen while loading; > 1 means bytes came over the network (not cache). */
  downloadEvents: number;
  downloadObserved: boolean;
  multithread: boolean;
  status: "ok" | "skipped" | "error" | "crashed";
  reason?: string;
  /** Set when the model loaded but warm-up/inference failed (e.g. OOM, GPU device lost). */
  inferenceError?: string;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const log = (line: string) => {
  const el = $<HTMLPreElement>("log");
  el.textContent += `${line}\n`;
  el.scrollTop = el.scrollHeight;
};

async function gpuAdapterInfo(): Promise<Record<string, string> | null> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  if (!gpu) return null;
  try {
    const adapter = (await gpu.requestAdapter()) as { info?: Record<string, string> } | null;
    if (!adapter?.info) return null;
    const { vendor, architecture, device, description } = adapter.info;
    return {
      vendor: vendor ?? "",
      architecture: architecture ?? "",
      device: device ?? "",
      description: description ?? "",
    };
  } catch {
    return null;
  }
}

async function environment() {
  const nav = navigator as Navigator & { deviceMemory?: number };
  return {
    userAgent: nav.userAgent,
    hardwareConcurrency: nav.hardwareConcurrency,
    deviceMemoryGB: nav.deviceMemory ?? null,
    crossOriginIsolated: window.crossOriginIsolated,
    webgpu: "gpu" in navigator,
    gpuAdapter: await gpuAdapterInfo(),
    pageCommit: __BUILD__.sha,
  };
}

function renderEnv(env: Awaited<ReturnType<typeof environment>>) {
  const rows: [string, string][] = [
    ["Cross-origin isolated", String(env.crossOriginIsolated)],
    ["WebGPU", env.webgpu ? env.gpuAdapter?.description || env.gpuAdapter?.vendor || "yes" : "no"],
    ["CPU threads", String(env.hardwareConcurrency)],
    ["Device memory", env.deviceMemoryGB ? `${env.deviceMemoryGB} GB` : "unknown"],
  ];
  $("env").innerHTML = rows
    .map(([k, v]) => `<div><dt>${k}</dt><dd><code>${v}</code></dd></div>`)
    .join("");
}

function renderChoices() {
  $("models").insertAdjacentHTML(
    "beforeend",
    MODELS.map(
      (m) =>
        `<label><input type="checkbox" name="model" value="${m.id}" checked /> ${m.file} <span class="muted">(${m.sizeMB} MB)</span></label>`,
    ).join(""),
  );
  $("backends").insertAdjacentHTML(
    "beforeend",
    BACKENDS.map(
      (b) =>
        `<label><input type="checkbox" name="backend" value="${b.id}" ${b.defaultOn ? "checked" : ""} /> ${b.label}</label>`,
    ).join(""),
  );
}

const checked = (name: string) =>
  [...document.querySelectorAll<HTMLInputElement>(`input[name=${name}]:checked`)].map(
    (i) => i.value,
  );

const fmt = (n: number | null, digits = 1) => (n === null ? "–" : n.toFixed(digits));

function renderResults(runs: RunRecord[], loads: (LoadRecord | CrashedLoad)[]) {
  const head = `<thead><tr><th>Model</th><th>Backend</th><th>Prompt</th><th>Constrained</th><th>Prompt tok</th><th>TTFT ms</th><th>Prefill ms</th><th>Prefill tok/s</th><th>Decode tok/s</th><th>Valid</th></tr></thead>`;
  const body = runs
    .map(
      (r) =>
        `<tr><td>${r.model}</td><td>${r.backend}</td><td>${r.shape}</td><td>${r.constrained ? "yes" : "no"}</td><td>${r.promptTokens ?? "–"}</td><td>${fmt(r.ttftMs, 0)}</td><td>${fmt(r.prefillMs, 0)}</td><td>${fmt(r.prefillTokPerSec)}</td><td>${fmt(r.decodeTokPerSec)}</td><td>${r.jsonOk && r.schemaErrors.length === 0 ? "✅" : r.jsonOk ? "⚠️ schema" : "❌ JSON"}</td></tr>`,
    )
    .join("");
  const skipped = loads
    .filter((l) => l.status !== "ok" || ("inferenceError" in l && l.inferenceError))
    .map(
      (l) =>
        `<tr><td>${l.model}</td><td>${l.backend}</td><td colspan="8">${"inferenceError" in l && l.inferenceError ? `inference error: ${l.inferenceError}` : `${l.status}: ${l.reason ?? ""}`}</td></tr>`,
    )
    .join("");
  $("results").innerHTML = head + `<tbody>${body}${skipped}</tbody>`;
}

// Test hooks: /spike/?fail=inference throws after the first timed run, to verify
// the page recovers and keeps partial results (review feedback on #99);
// /spike/?fail=crash reloads the page mid-load, simulating iOS killing the tab (#108).
const FAULT = new URLSearchParams(location.search).get("fail");

// Results survive a killed tab (#108): every step is saved to localStorage.
const store: Store = (() => {
  try {
    return window.localStorage;
  } catch {
    // storage blocked (e.g. some private modes): keep working in memory
    const mem = new Map<string, string>();
    return {
      getItem: (k) => mem.get(k) ?? null,
      setItem: (k, v) => void mem.set(k, v),
      removeItem: (k) => void mem.delete(k),
    };
  }
})();
let session: Session = loadSession(store, new Date().toISOString());
const persist = () => {
  if (!saveSession(store, session))
    log("  warning: couldn't save progress (storage full or blocked)");
};

const loadsOf = (s: Session) => s.loads as (LoadRecord | CrashedLoad)[];
const runsOf = (s: Session) => s.runs as RunRecord[];

function resultJson() {
  const loads = loadsOf(session);
  const runs = runsOf(session);
  return {
    spike: "#66",
    startedAt: session.startedAt,
    savedAt: new Date().toISOString(),
    complete: isComplete({ loads, runs }),
    crashedCells: loads.filter((l) => l.status === "crashed").length,
    env: session.env,
    loads,
    runs,
  };
}

function refreshDownload() {
  const download = $<HTMLButtonElement>("download");
  download.disabled = session.loads.length === 0 && session.runs.length === 0;
  download.onclick = () => {
    const blob = new Blob([JSON.stringify(resultJson(), null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `jobtrail-spike66-${Date.now()}.json`;
    a.click();
  };
  (window as Window & { __spikeResult?: unknown }).__spikeResult = resultJson();
}

// One benchmark at a time (review on #109): Run and Clear are locked before the first
// await, so a double-tap can't start two loops over the same cells, and Clear can't
// swap out the session while a run is still appending to it.
let running = false;
function setRunning(on: boolean) {
  running = on;
  $<HTMLButtonElement>("run").disabled = on;
  $<HTMLButtonElement>("clear").disabled = on;
}

async function runBenchmark() {
  if (running) return;
  setRunning(true);
  try {
    await runCells();
  } finally {
    setRunning(false);
  }
}

async function runCells() {
  const runButton = $<HTMLButtonElement>("run");
  $("log").textContent = "";
  if (checked("model").length === 0 || checked("backend").length === 0) {
    log("Select at least one model and one backend.");
    return;
  }
  const env = await environment();
  session.env ??= env;
  const cells = MODELS.filter((m) => checked("model").includes(m.id)).flatMap((model) =>
    BACKENDS.filter((b) => checked("backend").includes(b.id)).map((b) => ({
      model: model.id,
      spec: model,
      backend: b.id,
    })),
  );
  const todo = pendingCells(session, cells);
  if (todo.length === 0) {
    log(
      "Every selected cell already finished or crashed. Download the results, or Clear to start over.",
    );
    return;
  }
  if (todo.length < cells.length)
    log(`Resuming: ${cells.length - todo.length} of ${cells.length} cells already done.`);
  const loads = loadsOf(session);
  const runs = runsOf(session);

  try {
    for (const { spec: model, backend } of todo) {
      if (backend === "webgpu" && !env.webgpu) {
        session = beginCell(session, model.id, backend, new Date().toISOString());
        loads.push({
          model: model.id,
          backend,
          requestedBackend: backend,
          loadMs: 0,
          downloadEvents: 0,
          downloadObserved: false,
          multithread: false,
          status: "skipped",
          reason: "WebGPU not available in this browser",
        });
        session = finishCell(session);
        persist();
        log(`skip ${model.id} ${backend}: no WebGPU`);
        continue;
      }
      // Mark the attempt before anything that can kill the tab.
      session = beginCell(session, model.id, backend, new Date().toISOString());
      persist();
      if (FAULT === "crash") {
        log(`simulating a tab crash while loading ${model.id} on ${backend}…`);
        location.reload();
        return;
      }
      const wllama = new Wllama({ default: wasmUrl }, { suppressNativeLog: true });
      let downloadEvents = 0;
      log(`load ${model.id} on ${backend}…`);
      const t0 = performance.now();
      try {
        await wllama.loadModelFromHF(
          { repo: model.repo, file: model.file },
          {
            n_ctx: 2048,
            n_gpu_layers: backend === "webgpu" ? 999 : 0,
            ...(backend === "wasm-st" ? { n_threads: 1 } : {}),
            progressCallback: ({ loaded, total }: { loaded: number; total: number }) => {
              downloadEvents += 1;
              if (total)
                $("run").textContent = `Downloading ${Math.round((loaded / total) * 100)}%`;
            },
          },
        );
      } catch (e) {
        loads.push({
          model: model.id,
          backend,
          requestedBackend: backend,
          loadMs: performance.now() - t0,
          downloadEvents,
          downloadObserved: downloadEvents > 1,
          multithread: false,
          status: "error",
          reason: String(e),
        });
        session = finishCell(session);
        persist();
        log(`  error: ${String(e)}`);
        await wllama.exit().catch(() => undefined);
        continue;
      }
      const loadMs = performance.now() - t0;
      const ran = effectiveBackend(backend, wllama.isMultithread());
      const loadRecord: LoadRecord = {
        model: model.id,
        backend: ran,
        requestedBackend: backend,
        loadMs,
        downloadEvents,
        downloadObserved: downloadEvents > 1,
        multithread: wllama.isMultithread(),
        status: "ok",
      };
      loads.push(loadRecord);
      session = setStage(session, "inference");
      persist();
      log(
        `  loaded in ${(loadMs / 1000).toFixed(1)}s (${downloadEvents > 1 ? "downloaded" : "from cache"}), multithread=${wllama.isMultithread()}`,
      );
      if (ran !== backend) {
        log(
          `  note: requested ${backend} but wllama is running ${ran} (page not cross-origin isolated?)`,
        );
      }
      $("run").textContent = "Running…";

      try {
        // Warm-up so one-time graph setup doesn't pollute the first timed run.
        await wllama.createChatCompletion({
          messages: [{ role: "user", content: "hi" }],
          max_tokens: 1,
          temperature: 0,
        });

        for (const [noteIndex, note] of SPIKE_NOTES.entries()) {
          for (const shape of ["long", "short"] as const) {
            for (const constrained of [true, false]) {
              // Streaming: the first content chunk gives a real TTFT, and llama.cpp's
              // timings arrive on the chunks (non-streamed responses don't type them).
              const t1 = performance.now();
              const stream = await wllama.createChatCompletion({
                messages: buildMessages(note, shape),
                stream: true,
                temperature: 0,
                max_tokens: 256,
                cache_prompt: false,
                chat_template_kwargs: { enable_thinking: false },
                ...(constrained
                  ? {
                      response_format: {
                        type: "json_schema" as const,
                        json_schema: { name: "job", schema: SPIKE_SCHEMA, strict: true },
                      },
                    }
                  : {}),
              });
              let output = "";
              let ttftMs: number | null = null;
              let t: ResultTimings | undefined;
              let promptTokens: number | null = null;
              for await (const chunk of stream) {
                const delta = chunk.choices[0]?.delta?.content ?? "";
                if (delta && ttftMs === null) ttftMs = performance.now() - t1;
                output += delta;
                if (chunk.timings) t = chunk.timings;
                if (chunk.usage?.prompt_tokens) promptTokens = chunk.usage.prompt_tokens;
              }
              const wallMs = performance.now() - t1;
              const parsed = parseModelJson(output);
              runs.push({
                model: model.id,
                backend: ran,
                note: noteIndex,
                shape,
                constrained,
                promptTokens: promptTokens ?? t?.prompt_n ?? null,
                ttftMs,
                prefillMs: t?.prompt_ms ?? null,
                prefillTokPerSec: t?.prompt_per_second ?? null,
                decodeTokens: t?.predicted_n ?? null,
                decodeTokPerSec: t?.predicted_per_second ?? null,
                wallMs,
                jsonOk: parsed.ok,
                schemaErrors: parsed.ok ? validateSpikeExtraction(parsed.value) : [],
                output,
              });
              persist();
              renderResults(runs, loads);
              refreshDownload();
              log(
                `  note ${noteIndex} ${shape} constrained=${constrained}: ${(wallMs / 1000).toFixed(1)}s`,
              );
              if (FAULT === "inference")
                throw new Error("injected inference failure (?fail=inference)");
            }
          }
        }
      } catch (e) {
        loadRecord.inferenceError = String(e);
        log(`  inference error: ${String(e)} — keeping ${runs.length} completed runs`);
      } finally {
        session = finishCell(session);
        persist();
        await wllama.exit().catch(() => undefined);
      }
    }
  } catch (e) {
    log(`fatal: ${String(e)}`);
  }

  renderResults(runs, loads);
  refreshDownload();
  runButton.textContent = "Run again";
  log("done.");
}

function startup() {
  const recovered = recoverCrash(session);
  session = recovered.session;
  if (recovered.crashed) {
    const c = recovered.crashed;
    persist();
    log(
      `The last run was cut off while ${c.stage === "load" ? "loading" : "running"} ${c.model} on ${c.backend} — ` +
        "the browser most likely killed the tab for using too much memory. Recorded as crashed; " +
        "tap Run to continue with the remaining cells.",
    );
  } else if (session.loads.length > 0) {
    log(
      `Saved results from ${session.startedAt} are loaded. Tap Run to continue, or Clear to start over.`,
    );
  }
  renderResults(runsOf(session), loadsOf(session));
  refreshDownload();
}

renderChoices();
void environment().then(renderEnv);
$("run").addEventListener("click", () => void runBenchmark());
$("clear").addEventListener("click", () => {
  if (running) return;
  clearSession(store);
  session = loadSession(store, new Date().toISOString());
  $("log").textContent = "Saved results cleared.\n";
  renderResults([], []);
  refreshDownload();
});
startup();
