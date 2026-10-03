# Results

Score reports produced by `pnpm score`; every number is defined in [`packages/core/SCORING.md`](../packages/core/SCORING.md).

| File               | What it is                                                                                                                    |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `rules.demo.jsonl` | Rule-based baseline (`rules-legacy-v0`) predictions on the 3 **demo fixtures** (`packages/core/fixtures/scoring/gold.jsonl`). |
| `rules.json`       | Its score report.                                                                                                             |

**These are not the baseline's real numbers.** n = 3 hand-written demo notes shows the pipeline works end to end; it measures nothing. The real floor is produced by the same two commands on the frozen test set (#71) in the baseline ladder (#73), which replaces these files. The matcher is validated (`matcher.provisional: false`, #114).

Reproduce:

```bash
pnpm baseline --gold packages/core/fixtures/scoring/gold.jsonl --out results/rules.demo.jsonl
pnpm score --gold packages/core/fixtures/scoring/gold.jsonl --pred results/rules.demo.jsonl --out results/rules.json --run rules-demo
```

Latency (`timings.wallMs`) is measured per run on the machine that ran it, so it differs between runs; everything else is deterministic.

## Batch runs (#72)

One command runs a model over a gold file and scores it with the same core scorer:

```bash
cd ml
uv run python scripts/run_llamacpp.py --config configs/gemma3-270m-q8-zero-shot.yaml
uv run python scripts/run_cloud.py --config configs/gemini-3.8-flash-zero-shot.yaml
uv run python scripts/score_run.py ../results/runs/<run id>   # re-score a finished run
```

A config (`ml/configs/*.yaml`) names the model (GGUF path, Hugging Face URL and SHA-256, or a cloud model id), the prompt variant (`zero-shot`, `few-shot` with the examples in `ml/prompts/fewshot.jsonl`, or `fine-tuned-short`: the note alone), the output `format` (`full` or `compact`), `grammar` (JSON-schema constrained decoding on or off), sampling, and the `gold` file. `--gold` and `--limit` override the config for smoke runs.

Each run lands in `results/runs/<id>/`. The ID is `<name>-<gold>-<hash8>`; the hash covers everything that can change a prediction (settings including the pinned llama.cpp build, the model file's SHA-256 or the cloud model id, the prompt text, the grammar schema and the gold file's bytes), so the same inputs always give the same ID. Paths, URLs, thread counts, rate limits and prices are left out because they don't change what the model writes. A misspelled setting is an error rather than silently ignored.

| File                | What                                                                                     |
| ------------------- | ---------------------------------------------------------------------------------------- |
| `config.json`       | The resolved config. It is itself a valid `--config`: rerunning it reproduces the run.   |
| `predictions.jsonl` | One line per note: `raw` exactly as generated, timings, token usage, finish reason.      |
| `run.json`          | Runtime build, host, status, token totals and, for cloud runs, cost at published prices. |
| `gold.jsonl`        | Only when `--limit` took a subset: the gold that run is scored on.                       |
| `report.json`       | The scorer's report, written once every note has a prediction.                           |

How the runners behave:

- **llama.cpp:** each run starts its own `llama-server`, refusing any build other than the config's `server.build` (b9837 here), on CPU (`gpu_layers: 0`, like the phones), with one slot and `--reasoning-format none`, so `raw` is exactly what the model wrote. Temperature 0 with a fixed seed is deterministic: rerunning a config reproduces every `raw` byte for byte (`evidence/72/`). The prompt cache is off, so each note's prefill is timed on its own, and an untimed warm-up runs first because the first request after a load is cold. `ttftMs` is the server's prompt time, which ends when the first token is sampled. A missing model is downloaded and its SHA-256 checked.
- **Cloud (Gemini):** structured output with schema v2, throttled to the config's requests per minute. When the free tier's daily quota runs out, the run stops cleanly and the same command resumes it the next day. Cost is computed at the published paid-tier prices in the config, even for a free run. Thinking tokens bill as output. Gemini 3 runs at temperature 1.0, as Google recommends, so cloud runs are seeded but not bit-reproducible.
- **Resume and re-scoring:** an interrupted run resumes where it stopped, and a line cut off by a crash is redone. `run.json` keeps the original start and logs each resume. A run refuses to mix in predictions from a different runtime build or thread count, a cloud run stops if the model starts answering as a different version, and `score_run.py` refuses to re-score against a gold file that changed since the run.
