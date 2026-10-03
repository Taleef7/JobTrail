# Small models and on-device runtimes: survey (2026-10-03)

This survey ran during #73 because the owner asked: are there more models like LFM2.5, and are other runtimes better suited than llama.cpp?

There were two multi-agent research passes:

- **models:** 5 search angles, then each of 31 candidates checked against its Hugging Face repo;
- **runtimes:** 5 angles plus a synthesis, then skeptics checking the 12 claims the recommendation rests on.

Every model name, size and licence below was read from the model's repo. The raw data is in [`2026-10-03-survey-data.json`](2026-10-03-survey-data.json): 31 unique candidates, plus the 12 runtime claims a skeptic checked against primary sources. Of those 12, 9 were confirmed, 2 held in substance with corrected details, and 1 stayed unverified (marked below). One more item, about wllama 3.8.x, comes from a third-party report and is also marked unverified.

## Models

### Added to the #73 ladder

| Model                         | File (size)       | Licence                    | Why                                                                                                                            |
| ----------------------------- | ----------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| LiquidAI LFM2.5-230M          | Q8_0 (247 MB)     | LFM Open v1.0 (< $10M rev) | Same family as LFM2.5-350M, recommended for extraction, and fits the iPhone web budget easily                                  |
| LiquidAI LFM2.5-350M          | QAD-Q4_0 (219 MB) | LFM Open v1.0              | Quantisation-aware distilled 4-bit file (2026-08-19). Liquid says it closes most of the Q4→BF16 gap. Likely the iPhone file    |
| IBM Granite 4.0-H-350M        | Q8_0 (366 MB)     | **Apache-2.0**             | Strongest model under 400M with no revenue cap. Hybrid Mamba2: it runs on llama.cpp b9837 (checked), but is untested in wllama |
| LiquidAI LFM2.5-1.2B-Instruct | Q4_K_M (731 MB)   | LFM Open v1.0              | Android tier. Liquid's card reports IFEval 86.2 and BFCLv3 49.1, against 73.7 and 46.3 for Qwen3-1.7B                          |
| LiquidAI LFM2-1.2B-Extract    | Q4_K_M (731 MB)   | LFM Open v1.0              | Liquid's purpose-built JSON extractor (older LFM2 base); could also check synthetic labels                                     |

### Considered, not added (one line each)

- **Falcon-H1-Tiny-Tool-Calling-90M** (TII, 116 MB): a cheap floor rung, but its AST scores are weak.
- **FunctionGemma-270M** (Google): its native output is a custom call format, not JSON, and the 262k vocabulary leaves Q4 barely smaller than Q8.
- **Osmosis-Structure-0.6B** and **NuExtract-1.5-tiny** (0.5B): both extraction-tuned, but both are about 400 MB at Q4, so Android only. NuExtract uses its own template format.
- **LFM2.5-VL-450M-Extract** (text-only): benchmarked only on images; flat JSON.
- **A community LFM2.5-350M "experience extractor":** its training repo is gone, and its domain is unrelated.
- **Granite 4.0-350M (dense):** the fallback if the hybrid H model fails in wllama.

### Fine-tuning (M2)

The same list as [`docs/RESULTS.md`](../RESULTS.md):

- **LFM2.5-350M stays the main candidate.** A published LoRA on about 5k synthetic examples took it from 34–63% to 96–98% on tool-call tasks ([distil labs](https://www.distillabs.ai/blog/fine-tuning-liquids-lfm25-accurate-tool-calling-at-350m-parameters/)).
- **Qwen3-0.6B** for Android.
- **LFM2.5-230M**, optional, if the iPhone needs something smaller than LFM2.5-350M's QAD-Q4_0 (219 MB).
- **Granite 4.0-H-350M** as the Apache-licensed hedge: the LFM licence allows commercial use only below US$10M annual revenue.

## Runtimes: keep llama.cpp everywhere

JobTrail runs llama.cpp on every surface:

- `llama-server` for the eval harness;
- wllama in the browser (ADR 0003);
- llama.rn in the app.

All three load one GGUF and turn the schema into a grammar with the same converter. No alternative beats it on more than one of our hard requirements without failing another.

| Requirement                        | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Constrained JSON (mandatory)       | [react-native-executorch](https://github.com/software-mansion/react-native-executorch) has no token-level constraint, only schema in the prompt plus repair. LiteRT-LM has [bug #3721](https://github.com/google-ai-edge/LiteRT-LM/issues/3721) (EOS allowed inside JSON strings), and its JS API has no response-format option. Transformers.js structured output is a [4.3 "experimental" package](https://github.com/huggingface/transformers.js/releases/tag/4.3.0).                                                                                                                            |
| One model artifact                 | ONNX isn't one artifact either: Liquid's exporter now writes onnxruntime-genai folders that "no longer load in Transformers.js" ([PR #46](https://github.com/Liquid4All/onnx-export/pull/46)).                                                                                                                                                                                                                                                                                                                                                                                                      |
| Low-end Android (Note 9S, SD 720G) | Everything runs on the CPU there. llama.rn loads its GPU/NPU build only with dotprod **and** i8mm; the 720G has no i8mm ([llama.rn](https://github.com/mybigday/llama.rn)). llama.cpp's [OpenCL doc](https://raw.githubusercontent.com/ggml-org/llama.cpp/master/docs/backend/OPENCL.md) says A6x phone GPUs are "likely not supported". On a Raspberry Pi 5 (4× Cortex-A76), llama.cpp ran Gemma 3 270M at 462 / 39 tok/s (prefill / decode) against LiteRT-LM's 433 / 23 ([Raspberry Pi with Google](https://www.raspberrypi.com/news/mastering-edge-ai-on-raspberry-pi-with-litert-and-gemma/)). |
| iPhone memory ceiling              | The ceiling is Safari's, not the runtime's: no WebAssembly Memory64 on iOS through 27.2 ([caniuse](https://caniuse.com/wf-wasm-memory64)). The native app (llama.rn, with the increased-memory entitlement) is the fix. _Unverified:_ the survey's estimate of WebKit's per-tab overhead.                                                                                                                                                                                                                                                                                                           |
| Direction of travel                | Liquid deprecated its LEAP SDK and now points developers to llama.cpp ([docs PR #126](https://github.com/Liquid4All/docs/pull/126), [mobile guide](https://docs.liquid.ai/deployment/on-device/llama-cpp/mobile)).                                                                                                                                                                                                                                                                                                                                                                                  |

**Two gaps in our own stack:**

1. **`quantity > 0` isn't enforced while decoding.** llama.cpp's [schema-to-grammar converter](https://github.com/ggml-org/llama.cpp/blob/master/common/json-schema-to-grammar.cpp) supports bounds only on integers and silently drops `exclusiveMinimum` on numbers. #72 saw LFM2 write quantity 0. Fix: commit one hand-patched GBNF and pass it identically to all three runtimes.
2. **wllama 3.8.x** reportedly fails with `json_schema` (unverified). Stay on 3.6.1 until the spike passes, or pass the committed GBNF instead.

**Speed on cheap phones** comes from three things, not from a runtime switch:

- the fine-tune dropping the ~400-token instruction prompt;
- reusing the fixed prompt prefix;
- tuning threads and quantisation.

**Revisit if any of these happens:**

- LiteRT-LM fixes #3721 and ships an official React Native binding;
- react-native-executorch gains constrained decoding;
- Safari ships Memory64;
- Transformers.js structured output leaves experimental.

**Proposed experiments** (follow-ups, not #73):

1. A native llama.rn benchmark on the Note 9S: LFM2.5-350M at Q4_0 and Q8_0, with 2, 4 and 6 threads, and long vs fine-tuned-short prompts.
2. The committed-GBNF fix, checked in llama-server, wllama and llama.rn.
3. iPhone 16 Pro native memory: LFM2.5-350M Q8_0, then LFM2.5-1.2B at Q4 and Q8.
4. Optional: Transformers.js with structured output in iOS Safari, if iPhone web quality becomes a priority.
