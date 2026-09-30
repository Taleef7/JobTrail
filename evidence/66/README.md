# Evidence — #66 in-browser runtime spike

| File                           | What                                                                                                                                                                                                                  |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bench-laptop.json`            | Full matrix on the local preview (48 runs): 3 GGUF files × WebGPU / WASM multi-thread × long/short prompt × constrained/unconstrained. Complete model outputs; validity checked with Ajv against the declared schema. |
| `bench-laptop-wasm-st.json`    | Single-thread WASM fallback, Gemma 3 270M Q8_0 (8 runs).                                                                                                                                                              |
| `after/live-spike-env.jpg`     | Live production page https://jobtrail-drab.vercel.app/spike/ reporting `Cross-origin isolated: true`, WebGPU (NVIDIA), 32 threads.                                                                                    |
| `after/live-spike-results.jpg` | Part of the live results table from the parity run below.                                                                                                                                                             |

Machine: Windows 11 laptop, AMD Ryzen 9 8940HX (16C/32T), NVIDIA GeForce RTX 5070 Ti Laptop GPU, 15 GB RAM; Claude desktop app browser (Chromium 152).

## Live parity run (production, commit `501ccca`, 2026-09-29)

Gemma 3 270M Q8_0, both notes averaged. `complete: true`, `crossOriginIsolated: true`; the WebGPU load downloaded the model (`downloadObserved: true`, 16.0 s), the WASM load came from cache (1.8 s).

| Backend | Prompt | Constrained | TTFT ms | Prefill tok/s | Decode tok/s | Schema-valid |
| ------- | ------ | ----------- | ------- | ------------- | ------------ | ------------ |
| webgpu  | long   | yes         | 406     | 1,634         | 67           | 2/2          |
| webgpu  | long   | no          | 189     | 2,203         | 71           | 0/2          |
| webgpu  | short  | yes         | 302     | 345           | 55           | 2/2          |
| webgpu  | short  | no          | 231     | 429           | 68           | 0/2          |
| wasm-mt | long   | yes         | 1,409   | 298           | 57           | 2/2          |
| wasm-mt | long   | no          | 1,269   | 319           | 58           | 0/2          |
| wasm-mt | short  | yes         | 282     | 223           | 47           | 2/2          |
| wasm-mt | short  | no          | 201     | 274           | 77           | 0/2          |

Consistent with `bench-laptop.json` within the run-to-run variance noted in ADR 0003 (e.g. WebGPU long prefill 1,634 vs 1,808; WASM long 298 vs 391), and validity is identical. The raw JSON of this run is **not** committed: the HTTPS production page can't POST to a localhost receiver (browser blocks it) and the embedded browser can't save downloads. The table above was read directly from the page's result object.

## Phone: Redmi Note 9S, Chrome 153 (owner, 2026-09-30, page `1f328e9`)

File: `phone-redmi-note-9s-chrome.json`. `complete: true`, `crossOriginIsolated: true`; WebGPU adapter: Qualcomm Adreno 6xx; 8 cores; `deviceMemory` 4 GB. Each WebGPU cell downloaded its model (70–97 s); each WASM cell loaded from cache (5.8–8.4 s).

| Model             | Backend | Prompt | Constrained | Prefill tok/s | Decode tok/s | Wall s (median) | Schema-valid |
| ----------------- | ------- | ------ | ----------- | ------------: | -----------: | --------------: | -----------: |
| gemma3-270m-q8_0  | webgpu  | long   | yes         |         24–31 |      4.1–4.3 |              39 |          2/2 |
| gemma3-270m-q8_0  | webgpu  | short  | yes         |         24–26 |      5.6–5.9 |              37 |          2/2 |
| gemma3-270m-q8_0  | wasm-mt | long   | yes         |         25–30 |      3.8–3.9 |              38 |          2/2 |
| gemma3-270m-q8_0  | wasm-mt | short  | yes         |         23–24 |      5.1–5.6 |              39 |          2/2 |
| gemma3-270m-q4_0  | wasm-mt | long   | yes         |         17–18 |          3.5 |              43 |          2/2 |
| gemma3-270m-q4_0  | wasm-mt | short  | yes         |         14–15 |      4.4–4.5 |              57 |          2/2 |
| qwen3-0.6b-q4_k_m | wasm-mt | long   | yes         |             8 |      1.3–1.4 |             161 |          2/2 |
| qwen3-0.6b-q4_k_m | wasm-mt | short  | yes         |             7 |      3.4–3.5 |              66 |          2/2 |

The constrained rows are shown here; the JSON has all 48 runs. Unconstrained Gemma was never schema-valid, and unconstrained Qwen was valid only with the long prompt, the same as on the laptop.

**What it shows:**

- On the minimum-spec phone, reading a 400-token prompt takes 12–17 s (Gemma Q8) and about 50 s (Qwen 0.6B).
- WebGPU gives this GPU no advantage: speeds match WASM, and so do the outputs.
- Q8_0 beats Q4_0 here too.

**One outlier:** Gemma Q4_0 / WASM / note 1 / short / unconstrained took 601 s at 0.43 tok/s. The screen probably locked or the tab went to the background during the run, so it is excluded from any conclusion.

## Phone: iPhone 16 Pro, iOS 26.7 (Safari and Chrome, both WebKit): crashes

Every cell loaded (about 2 s from cache) and then the tab was killed at the first inference:

- Gemma Q8 and Q4;
- WebGPU, WASM multi-thread and single-thread.

The #108 recovery recorded each crash, but there is no JSON worth committing yet. No Jetsam event was logged. Investigation and hypotheses are in #110 and ADR 0003; that issue adds `?compat=1`, `?threads=`, `?ctx=`, finer crash stages and smaller models to diagnose it on the device.
