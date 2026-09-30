# ADR 0003 — In-browser runtime: wllama (llama.cpp → WASM/WebGPU)

- **Status:** Accepted (laptop measurements); phone-browser numbers pending
- **Date:** 2026-09-29
- **Issue:** #66 · **Evidence:** [`evidence/66/`](../../evidence/66/)

## Context

The web app's "try it in your browser" page (#89) must run the **same model file** as the phone app, so that one GGUF artifact is evaluated in llama.cpp on the desktop, in the browser, and on the phone (design §4, rule 3). We needed to know whether an in-browser llama.cpp runtime is fast and reliable enough, and which backend and quantization to default to.

## What we measured

`/spike/` runs a fixed matrix and records llama.cpp's own timings (`prompt_per_second`, `predicted_per_second`) plus a real time-to-first-token from streaming. Laptop run: Chrome 152, 32 threads, NVIDIA (Blackwell) GPU, `crossOriginIsolated: true`, wllama 3.6.1. 2 hard-case notes per cell; temperature 0; max 256 tokens.

Averages over both notes (from [`bench-laptop.json`](../../evidence/66/bench-laptop.json); complete model outputs are stored per run, and validity is checked against the declared JSON Schema with Ajv):

| Model (file)               | Backend           | Prompt         | Prefill tok/s | Decode tok/s | TTFT   | Schema-valid (constrained / unconstrained) |
| -------------------------- | ----------------- | -------------- | ------------- | ------------ | ------ | ------------------------------------------ |
| Gemma 3 270M Q8_0 (292 MB) | WebGPU            | long (403 tok) | 1,808         | 63           | 0.40 s | 2/2 · 0/2                                  |
| Gemma 3 270M Q8_0          | WASM multi-thread | long           | 391           | 66           | 1.09 s | 2/2 · 0/2                                  |
| Gemma 3 270M Q8_0          | WASM multi-thread | short (54 tok) | 299           | 57           | 0.21 s | 2/2 · 0/2                                  |
| Gemma 3 270M Q4_0 (242 MB) | WebGPU            | long           | 1,896         | 56           | 0.42 s | 2/2 · 0/2                                  |
| Gemma 3 270M Q4_0          | WASM multi-thread | long           | 196           | 43           | 2.17 s | 2/2 · 0/2                                  |
| Qwen3-0.6B Q4_K_M (397 MB) | WebGPU            | long (397 tok) | 1,248         | 54           | 0.59 s | 2/2 · 2/2                                  |
| Qwen3-0.6B Q4_K_M          | WASM multi-thread | long           | 116           | 29           | 3.58 s | 2/2 · 2/2                                  |

**Run-to-run variance is large.** An earlier session on the same machine (discarded: it stored truncated outputs and used a laxer validator) measured Gemma Q8_0 WASM prefill at 239 tok/s vs 391 here. Every _direction_ below held in both sessions, but differences under ~1.5× should not drive decisions, and phone numbers need repeated runs.

Single-thread WASM (the fallback when a page isn't cross-origin isolated), Gemma 3 270M Q8_0, same session, from [`bench-laptop-wasm-st.json`](../../evidence/66/bench-laptop-wasm-st.json): prefill **32 tok/s**, decode **9 tok/s**, TTFT **13.1 s** on the long prompt and 1.9 s on the short one; **~22 s** per constrained extraction vs 2.8 s multi-threaded.

## Findings

1. **JSON-schema constrained decoding is mandatory for these models.** Constrained output was schema-valid in 100% of runs across all models and backends. Unconstrained, Gemma 270M produced valid JSON in **0%** of runs even with full instructions — it wrote JavaScript, echoed the schema, or replied "Okay, I understand." Qwen3-0.6B followed instructions (2/2 with the long prompt) but not without them.
2. **Valid is not correct.** Constrained, zero-shot Gemma 270M output parsed perfectly but was wrong on the facts (labor "an hour and a half" → `0`/`1`/`2`; "customer signed off" → `false`; supply-house trip listed as a material). Accuracy is M1's job (#67–#73); this spike measures speed and reliability only.
3. **Prefill is what fine-tuning buys back on CPU.** The instruction prompt is ~7.5× longer than the note alone (403 vs 54 tokens). On WASM multi-thread, that's ~1.1–3.6 s vs ~0.2–0.6 s to first token.
4. **…but only if the model also learns to be concise.** Without instructions, the untuned models padded their constrained output (166–232 tokens vs 59–140 with instructions), so end-to-end time often got _worse_ on the short prompt (e.g. Gemma Q4_0 WASM: 3.4 s → 6.2 s). The fine-tune (#75) must teach format **and** brevity; the compact output codec (#67) helps further.
5. **WebGPU accelerates prefill ~5–11×, decode only ~1–1.9×** at this size (decode sits at ~30–70 tok/s everywhere). For short notes and short outputs, WASM multi-thread is within a few seconds of WebGPU.
6. **In the browser, Q8_0 beat Q4_0 on speed** for Gemma 270M on WASM (prefill 391 vs 196 tok/s, decode 66 vs 43; same direction in the earlier session) while being only 50 MB larger — Gemma's 256k-token embedding table dominates its size, so 4-bit saves little. This must be **re-measured on the phone** (native ARM kernels differ; #64).
7. **Cross-origin isolation is not optional.** Without COOP/COEP, wllama falls back to one thread and a constrained extraction takes ~22 s instead of ~2.8 s on the same machine (~8×).
8. **Loads are fast once cached** (1.0–4.3 s in this run). First loads include the 242–397 MB download; that time depends on the connection and isn't captured in the committed evidence.

## Phone findings (2026-09-30, #110)

9. **Redmi Note 9S (Chrome, Adreno 618): it works, but it's slow, and WebGPU doesn't help.**
   - WebGPU cells ran at the same speed as WASM multi-thread and produced identical outputs.
   - Reading the prompt runs at 24–33 tok/s (Gemma 270M Q8), so the 400-token instruction prompt costs 12–17 s before the first token. Writing runs at 4–6 tok/s.
   - Q8_0 is faster than Q4_0 on the phone too (prefill 24–30 vs 14–18 tok/s).
   - Qwen3-0.6B is about 3× slower (prefill 7–9 tok/s, 2–2.7 min per long note), though it was the most accurate zero-shot.
   - Evidence: `evidence/66/phone-redmi-note-9s-chrome.json`.
10. **iPhone 16 Pro (iOS 26.7, Safari and Chrome): the tab dies at the first inference.** This happens for every model and backend, including Q4 single-thread. The model loads in about 2 s and no Jetsam event is logged. Reproduced with desktop WebKit 26.6 (Playwright), which does _not_ crash:
    - WebKit uses about 0.9–1.0 GB of physical memory for Gemma Q8, against about 0.6 GB in Chromium;
    - it reserves 4.5–5 GB of address space whether or not the page is isolated, WebKit's normal wasm reservation;
    - physical memory scales with the model: SmolLM2-135M about 0.47–0.64 GB, LFM2-350M about 0.5–0.8 GB;
    - threads, the 32-bit compat build and context size barely matter.

    **Resolved on the device (#110):** it's the tab's memory limit. iOS 26.7 has no JSPI and no Memory64, so wllama _always_ runs its 32-bit compat build there; the constructor enables compat by default, which rules out the 64-bit-build hypothesis.
    - SmolLM2-135M loaded **from cache** completed all 8 runs (prefill 36–60 tok/s, decode 19–42 tok/s, single thread).
    - The same model straight after a fresh download was killed at `run:0`.
    - Gemma 270M (about 1 GB in WebKit) was killed either way.

    The spike therefore gains **Download models only**: pre-fill the cache, reload, then Run. Its session `env` now records the latest run's page and capabilities.

    **Confirmed on the device:** with Download models only → reload → Run, LFM2-350M-Extract Q8_0 (380 MB, 0.5–0.8 GB in desktop WebKit) completed all 8 runs (prefill 25–30 tok/s, decode 17–22 tok/s). A second model loaded in the same tab was killed, so one model fits per page load. The crash-recovery flow (#108) kept the finished results and recorded the killed cell. See `evidence/66/phone-iphone-16-pro-chrome-lfm2-download-only.json`.

## Decision

- **Runtime: wllama** for the web. It runs the identical GGUF used by llama.rn on the phone and by llama.cpp in the eval harness, supports WebGPU with automatic WASM fallback, and exposes `response_format: json_schema` and llama.cpp timings.
- **Always constrain** extraction with the schema v2 JSON Schema (from `packages/core`, #67).
- **Backend order:** WebGPU → WASM multi-thread (requires COOP/COEP on the page) → WASM single-thread.
- **Web default quant:** Q8_0 for ≤ 300M-parameter models (faster _and_ barely larger in WASM); revisit per model after M2.
- **Not chosen:** WebLLM (needs MLC-compiled weights — a second model artifact, breaking "one model file"); Transformers.js (needs an ONNX export — same problem); Chrome Prompt API (Chrome-desktop-only system model — can't run _our_ fine-tuned model).

## Consequences

- Pages running the model must be served with `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` (currently scoped to `/spike/*` in `apps/web/vercel.json`; #89 extends it).
- Model files stay under wllama's 2 GB per-file limit (all candidates are ≤ 640 MB).
- **iOS web: one small model, run from cache.** On iPhone the web demo (#89) must:
  - offer a model with a ≤ ~400 MB GGUF (LFM2-350M-Extract Q8_0 and SmolLM2-135M fit; Gemma 270M does not);
  - separate _download_ from _first run_ (download, reload, run);
  - load one model per page load.

  The native app (llama.rn, #64) remains the main iPhone path.

- The same spike page is the measurement tool for phone browsers (Note 9S Chrome, iPhone 16 Pro Safari): run it, press **Download results JSON**, commit to `evidence/66/`. Both phones are measured (#110).
