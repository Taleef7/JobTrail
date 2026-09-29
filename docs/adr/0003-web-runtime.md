# ADR 0003 — In-browser runtime: wllama (llama.cpp → WASM/WebGPU)

- **Status:** Accepted (laptop measurements); phone-browser numbers pending
- **Date:** 2026-09-29
- **Issue:** #66 · **Evidence:** [`evidence/66/`](../../evidence/66/)

## Context

The web app's "try it in your browser" page (#89) must run the **same model file** as the phone app, so that one GGUF artifact is evaluated in llama.cpp on the desktop, in the browser, and on the phone (design §4, rule 3). We needed to know whether an in-browser llama.cpp runtime is fast and reliable enough, and which backend and quantization to default to.

## What we measured

`/spike/` runs a fixed matrix and records llama.cpp's own timings (`prompt_per_second`, `predicted_per_second`) plus a real time-to-first-token from streaming. Laptop run: Chrome 152, 32 threads, NVIDIA (Blackwell) GPU, `crossOriginIsolated: true`, wllama 3.6.1. 2 hard-case notes per cell; temperature 0; max 256 tokens.

Averages over both notes (from [`bench-laptop.json`](../../evidence/66/bench-laptop.json)):

| Model (file)               | Backend           | Prompt         | Prefill tok/s | Decode tok/s | TTFT   | Valid JSON (constrained / unconstrained) |
| -------------------------- | ----------------- | -------------- | ------------- | ------------ | ------ | ---------------------------------------- |
| Gemma 3 270M Q8_0 (292 MB) | WebGPU            | long (403 tok) | 1,674         | 57           | 0.43 s | 2/2 · 0/2                                |
| Gemma 3 270M Q8_0          | WASM multi-thread | long           | 239           | 42           | 1.78 s | 2/2 · 0/2                                |
| Gemma 3 270M Q8_0          | WASM multi-thread | short (54 tok) | 184           | 35           | 0.35 s | 2/2 · 0/2                                |
| Gemma 3 270M Q4_0 (242 MB) | WebGPU            | long           | 1,729         | 46           | 0.49 s | 2/2 · 0/2                                |
| Gemma 3 270M Q4_0          | WASM multi-thread | long           | 150           | 37           | 2.83 s | 2/2 · 0/2                                |
| Qwen3-0.6B Q4_K_M (397 MB) | WebGPU            | long (397 tok) | 1,044         | 55           | 0.70 s | 2/2 · 2/2                                |
| Qwen3-0.6B Q4_K_M          | WASM multi-thread | long           | 102           | 25           | 4.06 s | 2/2 · 2/2                                |

Single-thread WASM (the fallback when a page isn't cross-origin isolated), Gemma 3 270M Q8_0, from [`bench-laptop-wasm-st.json`](../../evidence/66/bench-laptop-wasm-st.json): prefill **30 tok/s**, decode **8 tok/s**, TTFT **13.7 s** on the long prompt and 1.9 s on the short one; ~23 s per constrained extraction — about 5× slower than multi-thread.

## Findings

1. **JSON-schema constrained decoding is mandatory for these models.** Constrained output was schema-valid in 100% of runs across all models and backends. Unconstrained, Gemma 270M produced valid JSON in **0%** of runs even with full instructions — it wrote JavaScript, echoed the schema, or replied "Okay, I understand." Qwen3-0.6B followed instructions (2/2 with the long prompt) but not without them.
2. **Valid is not correct.** Constrained, zero-shot Gemma 270M output parsed perfectly but was wrong on the facts (labor "an hour and a half" → `0`/`1`/`2`; "customer signed off" → `false`; supply-house trip listed as a material). Accuracy is M1's job (#67–#73); this spike measures speed and reliability only.
3. **Prefill is what fine-tuning buys back on CPU.** The instruction prompt is ~7.5× longer than the note alone (403 vs 54 tokens). On WASM, that's the difference between ~1.8–4.1 s and ~0.35–0.74 s to first token.
4. **…but only if the model also learns to be concise.** Without instructions, the untuned models padded their output (190–230 tokens vs 60–140), so end-to-end time got _worse_ on the short prompt. The fine-tune (#75) must teach format **and** brevity; the compact output codec (#67) helps further.
5. **WebGPU accelerates prefill 6–10×, decode only ~1.3×** at this size (decode sits at 35–60 tok/s everywhere). For short notes and short outputs, WASM multi-thread is within a few seconds of WebGPU.
6. **In the browser, Q8_0 beat Q4_0 on speed** for Gemma 270M on WASM (prefill 239 vs 150 tok/s, decode 42 vs 37) while being only 50 MB larger — Gemma's 256k-token embedding table dominates its size, so 4-bit saves little. This must be **re-measured on the phone** (native ARM kernels differ; #64).
7. **Cross-origin isolation is not optional.** Without COOP/COEP, wllama falls back to one thread and a constrained extraction takes ~23 s instead of ~4.5 s on the same machine.
8. **Loads are fast once cached** (1.7–2.2 s). First loads include the download (17.7 s for 292 MB, 22.1 s for 397 MB on this connection).

## Decision

- **Runtime: wllama** for the web. It runs the identical GGUF used by llama.rn on the phone and by llama.cpp in the eval harness, supports WebGPU with automatic WASM fallback, and exposes `response_format: json_schema` and llama.cpp timings.
- **Always constrain** extraction with the schema v2 JSON Schema (from `packages/core`, #67).
- **Backend order:** WebGPU → WASM multi-thread (requires COOP/COEP on the page) → WASM single-thread.
- **Web default quant:** Q8_0 for ≤ 300M-parameter models (faster _and_ barely larger in WASM); revisit per model after M2.
- **Not chosen:** WebLLM (needs MLC-compiled weights — a second model artifact, breaking "one model file"); Transformers.js (needs an ONNX export — same problem); Chrome Prompt API (Chrome-desktop-only system model — can't run _our_ fine-tuned model).

## Consequences

- Pages running the model must be served with `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` (currently scoped to `/spike/*` in `apps/web/vercel.json`; #89 extends it).
- Model files stay under wllama's 2 GB per-file limit (all candidates are ≤ 640 MB).
- The same spike page is the measurement tool for phone browsers (Note 9S Chrome, iPhone 16 Pro Safari): run it, press **Download results JSON**, commit to `evidence/66/`. Until then, phone-browser performance is **not measured**.
