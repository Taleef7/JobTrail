# #72: batch inference runners

**Before (main @ `a1fe065`):** there was no way to run a model over a split. `ml/scripts/` held only `check_constrained.py` (#67: 3 hand-picked notes), `gen_eval_notes.py` and `review_queue.py`, and there was no `ml/configs/`.

**After:** `ml/scripts/run_llamacpp.py` and `ml/scripts/run_cloud.py` each run a config and score it. How they work is in [`results/README.md`](../../results/README.md#batch-runs-72).

All runs here use the **110 dev drafts** (`data/drafts/dev.jsonl`), which are not frozen yet. They test the plumbing and **are not baseline results**. The baseline ladder runs on the frozen sets in #73.

Machine: Windows 11, AMD Ryzen (family 25), llama.cpp b9837, CPU only (`gpu_layers: 0`). Everything below is in `runs/` and in [`checks.json`](checks.json).

## One command per run, scored automatically

```bash
cd ml
uv run python scripts/run_llamacpp.py --config configs/gemma3-270m-q8-zero-shot.yaml --gold ../data/drafts/dev.jsonl --out-dir ../evidence/72/runs
```

| Run (`runs/<id>`)                             | Prompt    | Grammar | Schema-valid | jobType | laborMinutes | Materials F1 | p50 wall |
| --------------------------------------------- | --------- | ------- | -----------: | ------: | -----------: | -----------: | -------: |
| `gemma3-270m-q8-zero-shot-dev-658e5cd9`       | zero-shot | on      |        99.1% |   20.0% |        65.5% |        0.742 |   1.70 s |
| `gemma3-270m-q8-few-shot-dev-a37cf646`        | few-shot  | on      |         100% |   32.7% |        58.2% |        0.044 |   0.83 s |
| `gemma3-270m-q8-zero-shot-free-dev-3d0aba8d`  | zero-shot | **off** |           0% |      0% |           0% |            0 |   0.89 s |
| `lfm2-350m-extract-q4-zero-shot-dev-24c06892` | zero-shot | on      |        79.1% |   15.5% |        51.8% |        0.583 |   1.64 s |
| `smollm2-135m-q8-zero-shot-dev-45f9e556`      | zero-shot | on      |         1.8% |      0% |         0.9% |        0.045 |   2.70 s |

Zero-edit is 0% for every untuned model, as #110 found on the demo notes. `report.json` in each folder has every metric, by tag and per record.

## Determinism and resume

[`checks.json`](checks.json) `determinism`: the Gemma zero-shot config was run twice into separate folders:

- **A:** run once, start to finish (`runs/gemma3-270m-q8-zero-shot-dev-658e5cd9`).
- **B:** killed after 100 s (46 of 110 notes done), then resumed by rerunning the same command.

Both runs got the same run ID. **All 110 `raw` outputs are byte-identical**, B's `run.json` logs one resume, and B has no duplicate predictions. Temperature 0, a fixed seed and one server slot are deterministic on this build.

## Re-scoring

`score_run.py` on run A rewrote `report.json` with the same SHA-256 (`88b80b46…`, [`checks.json`](checks.json) `rescoring`). Re-scoring refuses a gold file that changed since the run (tested in `ml/tests/test_runs.py`).

## Cloud ceiling: quota stop and cost

```bash
uv run python scripts/run_cloud.py --config configs/gemini-3.8-flash-zero-shot.yaml --gold ../data/drafts/dev.jsonl --limit 10 --out-dir ../evidence/72/runs
```

`runs/gemini-3.8-flash-zero-shot-dev-b94fe71b` ran on the **free** key:

- After 7 of 10 notes, the free tier's daily limit (`GenerateRequestsPerDayPerProjectPerModel-FreeTier=20`, partly used earlier that day) stopped the run cleanly. It exited with code 3, kept the 7 predictions, and set `run.json` `status: quota`. The same command resumes after the reset.
- Tokens for the 7 notes: 2,948 prompt, 792 output and 2,981 thinking (thinking level `medium`).
- Cost at published paid-tier prices: **$0.0023 per note** through 2026-12-31 and **$0.0047 per note** from 2027-01-01, when the price doubles. A full 275-note ceiling run would cost about $0.64 at the current price; it runs on the free key over several days.
- No key appears in any file. `config.json` records only the variable name, `GEMINI_API_KEY`.

## Findings for #73 (not fixed here: they are model behavior)

- **Looping.** Greedy decoding at temperature 0 can repeat a list item until `max_tokens`. This happened on SmolLM2 in 108 of 110 notes, LFM2 in 18 and Gemma in 1. The grammar can't stop an endless array. These are recorded as `finishReason: length` and score as parse failures.
- **Quantity 0.** The grammar doesn't enforce `quantity > 0`: llama.cpp's JSON-schema conversion skips `exclusiveMinimum`. LFM2 wrote quantity 0 fourteen times, in 5 notes, and the scorer counts those as schema-invalid. LFM2's other schema failures are truncated answers in which the scorer's first balanced `{…}` is a nested object.
- **Few-shot hurt Gemma on materials.** Materials F1 fell from 0.742 to 0.044, while jobType rose from 20.0% to 32.7%. The small model seems to copy the examples' materials; check this in #73's error analysis.
- **Grammar off.** Without the grammar, Gemma 270M writes JSON with its own keys inside a code fence, so nothing is schema-valid. Constrained decoding is what makes these models usable at all.
