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

## Not measured yet

Phone browsers (Redmi Note 9S Chrome, iPhone 16 Pro Safari). To add: open `/spike/` on the phone, **Run benchmark**, **Download results JSON**, commit here.
