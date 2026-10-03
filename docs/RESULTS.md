# Results v0: the baseline ladder (#73)

Every rung below ran on the frozen sets (#71): **test** (163 notes) for the numbers, **dev** (110 notes) for the error analysis. Every number comes from the core scorer ([`packages/core/SCORING.md`](../packages/core/SCORING.md)).
Runs are reproducible with one command each (#72). The predictions, configs and run metadata are in [`results/runs/`](../results/runs/), and the summary is in [`results/summary.json`](../results/summary.json).

The data is synthetic and its labels were model-reviewed, not human-verified ([`docs/DATA_CARD.md`](DATA_CARD.md)). Read every number as "on these notes".

## Headline (test, n = 163)

Each model's best prompt is shown. **Zero-edit** is the share of records a user could accept with no change (the product metric).

| Rung                  | Model                                |     Size | Prompt       | Zero-edit | jobType | laborMinutes | Approved | Materials F1 | Work F1 | Hallucination | p50 latency |
| --------------------- | ------------------------------------ | -------: | ------------ | --------: | ------: | -----------: | -------: | -----------: | ------: | ------------: | ----------: |
| Floor                 | rules (`rules-legacy-v0`)            |        – | –            |      0.0% |   33.7% |        63.8% |    51.5% |        0.349 |   0.320 |          4.2% |       <1 ms |
| ≤ 400 MB (iPhone web) | SmolLM2-135M Q8_0                    |   145 MB | few-shot     |      0.0% |    8.6% |        57.1% |     4.3% |        0.129 |   0.496 |         16.1% |      0.53 s |
|                       | LFM2.5-350M QAD-Q4_0                 |   219 MB | few-shot     |      1.2% |   27.0% |        69.9% |    84.0% |        0.853 |   0.701 |          2.5% |      0.74 s |
|                       | LFM2.5-350M Q8_0                     |   379 MB | few-shot     |      1.2% |   33.7% |        70.6% |    84.7% |        0.815 |   0.714 |          2.2% |      1.14 s |
|                       | Granite 4.0-H-350M Q8_0 (Apache-2.0) |   366 MB | few-shot     |      3.1% |   21.5% |        66.9% |    85.3% |        0.861 |   0.804 |          2.4% |      2.79 s |
| ≤ 1.1 GB (Android)    | Qwen3-0.6B Q4_K_M                    |   397 MB | few-shot     |      1.8% |   39.3% |        81.6% |    81.0% |        0.854 |   0.801 |          1.8% |      1.89 s |
|                       | LFM2.5-1.2B Q4_K_M                   |   731 MB | few-shot     |      7.4% |   47.2% |        84.0% |    88.3% |        0.925 |   0.848 |          1.7% |      2.15 s |
|                       | Llama 3.2 1B Q4_K_M                  |   808 MB | few-shot v2  |     12.9% |   74.2% |        77.3% |    94.5% |        0.773 |   0.839 |          3.1% |      1.90 s |
|                       | **Qwen3-1.7B Q4_K_M**                | 1,107 MB | few-shot v2  | **19.0%** |   76.1% |        92.0% |   100.0% |        0.945 |   0.869 |          1.3% |      3.22 s |
| Ceiling               | Gemini 3.8 Flash (High)              |    cloud | zero-shot v1 |     80.4% |   97.5% |       100.0% |   100.0% |        0.998 |   0.992 |          0.0% |           – |
|                       | **Gemini 3.8 Flash (High)**          |    cloud | zero-shot v2 | **92.6%** |  100.0% |       100.0% |   100.0% |        0.998 |   0.994 |          0.0% |           – |

**How to read the latency and cost columns:**

- **Latency** is the median wall time per note on a desktop CPU (AMD Zen 4, llama.cpp b9837, CPU only, one slot). It is not a phone number: phones come in M2/M3.
- **Schema validity** is 96–100% for every row above, with the JSON-schema grammar on.
- **Every local model costs $0 per note.**
- **The ceiling's cost:** it ran through the Antigravity CLI on the owner's plan, batched 15 notes per call, so it has no price or latency of its own. One note per call through the Gemini API, as measured in #72 ([`evidence/72`](../evidence/72/README.md)), costs about **$0.0023 per note** at 2026 prices and **$0.0047 per note** from 2027-01-01. That run was thinking `medium` and the ladder was `high`, so read it as an estimate.

## What the ladder shows

1. **Without the grammar, nothing works.** Every small model run without JSON-schema constrained decoding is at most 1.8% schema-valid. With it, most rows are 96–100%. The exceptions:
   - SmolLM2-135M zero-shot at 2.5%: it repeats a list item until the token cap;
   - LFM2-350M-Extract at 73–84%;
   - LFM2.5-350M zero-shot at 93.9% with v1 and 82.8% with v2.
2. **Few-shot beats zero-shot on every model.** Llama 3.2 1B without examples returns `jobType: null` on 161 of 163 test notes.
3. **Size matters a lot below 1B:**
   - nothing at 400 MB or less beats 3.1% zero-edit;
   - Qwen3-1.7B and Llama 3.2 1B reach 12.9–19.0%;
   - the ceiling is at 93%.

   The per-tag table shows where: self-corrections, multiple materials and supply-house trips are almost never fully right below 1B.

4. **Prompt v2 helps the big models and hurts the small one.** v2 is longer and states the rules v1 left out (below).
   - The ceiling went from 80.4% to 92.6%, Qwen3-1.7B few-shot from 13.5% to 19.0%, and Llama 1B from 10.4% to 12.9%.
   - LFM2.5-350M went down: 1.2% → 0.0% few-shot, and 93.9% → 82.8% schema-valid zero-shot.
   - Prompting can't carry a 350M model.
5. **Quantisation-aware 4-bit is nearly free.** LFM2.5-350M QAD-Q4_0 matches its Q8_0 at 58% of the size and about a third faster.
6. **Specialist models weren't better.**
   - LFM2-1.2B-Extract, Liquid's extraction model, hallucinates (17–36%) under our schema and rules.
   - LFM2-350M-Extract loops and copies the prompt's example.
   - The general LFM2.5 models beat both.
7. **The Gemini bias check is clean.** Gemini 3.8 Flash helped review the gold it is graded on (#71), so its score was checked on the 158 test notes where Claude's vote alone matches the final key. There it scores 93.7% zero-edit with v2 and 79.7% with v1, against 92.6% and 80.4% on all notes. No sign that the review inflated its own score.

### Per hard-case tag (test, zero-edit)

| Tag                | rules | LFM2.5-350M few-shot | Granite-H-350M few-shot | Qwen3-1.7B few-shot v2 | Gemini 3.8 Flash v2 |
| ------------------ | ----: | -------------------: | ----------------------: | ---------------------: | ------------------: |
| hours-phrasing     |  0.0% |                 0.0% |                    4.0% |                  20.0% |               96.0% |
| negation           |  0.0% |                 0.0% |                    4.2% |                  20.8% |               91.7% |
| self-correction    |  0.0% |                 0.0% |                    0.0% |                   4.0% |               96.0% |
| multiple-materials |  0.0% |                 0.0% |                    0.0% |                  12.5% |               95.8% |
| no-materials       |  0.0% |                 8.0% |                    8.0% |                  44.0% |               96.0% |
| supply-house-trip  |  0.0% |                 0.0% |                    0.0% |                   8.3% |               95.8% |
| extra-labor        |  0.0% |                 0.0% |                    3.8% |                  19.2% |               92.3% |
| approval-absent    |  0.0% |                 0.0% |                    0.0% |                  16.0% |               88.0% |

## Error analysis (dev)

**Method**, Hamel-style:

- 68 failures (records that weren't zero-edit) were sampled with a fixed seed ([`ml/scripts/failures.py`](../ml/scripts/failures.py)):
  - all 13 of the ceiling's (v1);
  - 25 from LFM2.5-350M few-shot;
  - 10 from LFM2-350M-Extract zero-shot;
  - 15 from Llama 3.2 1B few-shot;
  - 5 from Llama 3.2 1B zero-shot.
- Blind Claude agents read each against `LABELING.md` and coded it freely, flagging any case where the gold or the scorer was at fault.
- Two independent axial codings were reconciled into one taxonomy, then every case was classified, with multiple labels and one primary cause.

The files are in [`results/error-analysis/`](../results/error-analysis/).

| Category                                                                                        | Cause        | Primary | Any | Examples (dev id, run)                                                                                           |
| ----------------------------------------------------------------------------------------------- | ------------ | ------: | --: | ---------------------------------------------------------------------------------------------------------------- |
| **Note content routed to the wrong field or slot** (`field-slot-routing`)                       | model        |      13 |  37 | d-0066 (lfm2.5-350m-few-shot), d-0033 (llama3.2-1b-few-shot), d-0019 (llama3.2-1b-few-shot)                      |
| **Run-default or unsupported trade on a clear note** (`trade-run-default`)                      | model        |       8 |  30 | d-0073 (lfm2.5-350m-few-shot), d-0054 (lfm2.5-350m-few-shot), d-0010 (lfm2-350m-extract-zero-shot)               |
| **Value invented where the note is silent** (`ungrounded-fill`)                                 | model        |       7 |  23 | d-0026 (lfm2.5-350m-few-shot), d-0047 (lfm2.5-350m-few-shot), d-0047 (llama3.2-1b-few-shot)                      |
| **Prompt or few-shot text copied into the record** (`prompt-example-copied`)                    | prompt       |       7 |  20 | d-0076 (lfm2-350m-extract-zero-shot), d-0016 (lfm2-350m-extract-zero-shot), d-0061 (lfm2.5-350m-few-shot)        |
| **Job's own task or chatter listed as an issue** (`issue-without-finding`)                      | prompt       |       6 |  19 | d-0022 (ceiling), d-0037 (ceiling), d-0077 (ceiling)                                                             |
| **Self-corrections, negations and stated times resolved wrong** (`spoken-modifier-misresolved`) | model        |      10 |  18 | d-0003 (lfm2.5-350m-few-shot), d-0036 (lfm2.5-350m-few-shot), d-0015 (lfm2.5-350m-few-shot)                      |
| **Materials rules v1 omits or never demonstrates** (`materials-rule-gap`)                       | prompt       |       4 |  10 | d-0072 (ceiling), d-0097 (ceiling), d-0012 (llama3.2-1b-few-shot)                                                |
| **Trade boundary the v1 prompt never defines** (`trade-boundary-undefined`)                     | prompt       |       4 |   8 | d-0031 (llama3.2-1b-few-shot), d-0082 (llama3.2-1b-few-shot), d-0069 (llama3.2-1b-few-shot)                      |
| **Debatable 'kit' unit convention scored as an error** (`kit-unit-convention`)                  | label/scorer |       5 |   5 | d-0011 (ceiling), d-0059 (ceiling), d-0063 (ceiling)                                                             |
| **Record fails to parse or validate** (`output-collapse`)                                       | model        |       4 |   4 | d-0036 (lfm2-350m-extract-zero-shot), d-0073 (lfm2-350m-extract-zero-shot), d-0062 (lfm2-350m-extract-zero-shot) |

"Primary" counts each failure under its single main cause. "Any" counts every category that applies, so a failure can appear in several rows.

**By cause:**

- The model's own capacity is the primary cause in **42 of 68**.
- The prompt is the primary cause in **21**. These cases led to prompt v2:
  - v1 never said supply-house parts are materials;
  - it never said package words like "kit" are units;
  - it never said an issue needs a finding;
  - it never listed what each trade covers;
  - its concrete examples were copied verbatim. LFM2-350M-Extract's output contains the prompt's "kitchen sink P-trap" on 75 of 110 dev notes.
- The label convention is the primary cause in **5**, all the ceiling's. In "1 drywall patch kit" the gold has `unit: "kit"`, while the model puts "kit" only in the name. Both say the same thing, and the scorer's exact unit match counts it as an error. Prompt v2 states the convention. A follow-up could make the scorer treat a unit equal to the name's last word as matching.

**The ceiling's failures were all prompt or convention issues** (kit units, issues without a finding, supply-house parts). That is why v2 took it from 80% to 93%. **The small models' failures are mostly capacity:**

- routing facts to the wrong field;
- defaulting `jobType` to one trade whatever the note says;
- inventing values;
- misreading spoken corrections.

## Go / no-go on fine-tuning: **GO**

**The hypothesis** (design doc): a fine-tuned model of 0.6B or less matches a ~2B general model's zero-shot at about a quarter of the download, and runs fast enough on the Redmi Note 9S (p50 ≤ 8 s).

**What the baseline says:**

- **Prompting can't close the gap at the sizes that fit the phones.** The best model of 400 MB or less is at 3.1% zero-edit. A longer, clearer prompt made LFM2.5-350M worse, and its errors are capacity errors (field routing, trade defaults, spoken corrections), which training data targets directly.
- **The bar is low and well defined.** The ~2B general model (Qwen3-1.7B) scores 9.2% zero-shot and 19.0% with the best prompt. The ceiling shows the task is learnable from these notes (93%).
- **Fine-tuning also fixes speed.** A fine-tuned model takes the note alone (the `fine-tuned-short` prompt, #72), so the phone skips the ~400-token instruction prompt. Its prefill was the bottleneck on the Note 9S (#66).
- **There is published evidence for this recipe.** LoRA on about 5k synthetic examples took LFM2.5-350M from 34–63% to 96–98% on tool-call tasks ([distil labs](https://www.distillabs.ai/blog/fine-tuning-liquids-lfm25-accurate-tool-calling-at-350m-parameters/)).

**Candidates for M2 (#74–#77):**

- **LFM2.5-350M**, shipped as QAD-Q4_0 at 219 MB for the iPhone web.
- **Granite 4.0-H-350M**: Apache-2.0, the strongest zero-edit at 400 MB or less, and a hedge against the LFM licence's US$10M revenue cap.
- **Qwen3-0.6B** for Android.

**Bar to beat:** Qwen3-1.7B few-shot v2 on dev, 29.1% zero-edit (19.0% on test). **Target:** approach the ceiling (97% on dev).

**What would turn this into a no-go:**

- a fine-tuned 350M model under 19% zero-edit on test;
- a p50 over 8 s on the Note 9S.

## Caveats

- **The notes are synthetic.** They were written by one Gemini model from templates, and the labels were model-reviewed, not human-verified. Spoken notes (#92) are reported separately when they exist.
- **Prompt v2 was designed from dev failures** and reported on test. Test was never used to choose anything: every model's variants are all in the full table.
- **The ceiling ran through an agent harness** (Antigravity), batched. Results from the raw API may differ slightly. The owner approves any API-key use; the cost above comes from #72's API measurement.
- **Latency is from a desktop CPU.** Phones are slower, and that is measured in M2/M3.

## Reproduce

```bash
cd ml
uv run python scripts/run_llamacpp.py --config configs/<run>.yaml --gold ../data/test.jsonl   # one local run
uv run python scripts/run_agy.py --config configs/gemini-3.8-flash-high-agy-b15-v2.yaml --gold ../data/test.jsonl
uv run python scripts/summarize_results.py --markdown   # results/summary.json + these tables
```

Score reports aren't committed. `score_run.py` rebuilds each one from its predictions, and `summary.json` records each report's SHA-256.

<details><summary>Full table: every run on test</summary>

| Rung  | Model                        |   MB | Prompt       | Grammar |   n | Zero-edit | Schema-valid | jobType | laborMinutes | Approved | Materials F1 | Work F1 | Issues F1 | Follow-ups F1 | Hallucination |    p50 |  $/note |
| ----- | ---------------------------- | ---: | ------------ | ------- | --: | --------: | -----------: | ------: | -----------: | -------: | -----------: | ------: | --------: | ------------: | ------------: | -----: | ------: |
| rules | rules-legacy-v0              |    – | -            | –       | 163 |      0.0% |       100.0% |   33.7% |        63.8% |    51.5% |        0.349 |   0.320 |     0.000 |         0.000 |          4.2% | 0.00 s | $0.0000 |
| local | SmolLM2-135M-Instruct-Q8_0   |  145 | few-shot     | on      | 163 |      0.0% |        96.3% |    8.6% |        57.1% |     4.3% |        0.129 |   0.496 |     0.000 |         0.175 |         16.1% | 0.53 s | $0.0000 |
| local | SmolLM2-135M-Instruct-Q8_0   |  145 | zero-shot    | off     | 163 |      0.0% |         0.0% |    0.0% |         0.0% |     0.0% |        0.000 |   0.000 |     0.000 |         0.000 |             – | 2.88 s | $0.0000 |
| local | SmolLM2-135M-Instruct-Q8_0   |  145 | zero-shot    | on      | 163 |      0.0% |         2.5% |    0.0% |         0.6% |     2.5% |        0.008 |   0.022 |     0.022 |         0.000 |          5.6% | 2.68 s | $0.0000 |
| local | LFM2.5-350M-QAD-Q4_0         |  219 | few-shot     | on      | 163 |      1.2% |       100.0% |   27.0% |        69.9% |    84.0% |        0.853 |   0.701 |     0.676 |         0.407 |          2.5% | 0.74 s | $0.0000 |
| local | LFM2.5-350M-QAD-Q4_0         |  219 | zero-shot    | on      | 163 |      0.0% |        96.3% |   17.2% |        62.0% |    81.6% |        0.794 |   0.357 |     0.363 |         0.000 |         12.5% | 0.84 s | $0.0000 |
| local | LFM2.5-230M-Q8_0             |  247 | few-shot     | on      | 163 |      0.0% |        98.8% |   31.3% |        63.2% |    59.5% |        0.732 |   0.607 |     0.536 |         0.416 |          7.9% | 0.86 s | $0.0000 |
| local | LFM2.5-230M-Q8_0             |  247 | zero-shot    | on      | 163 |      0.0% |        99.4% |   31.3% |        60.7% |    82.2% |        0.841 |   0.386 |     0.453 |         0.176 |          5.8% | 0.95 s | $0.0000 |
| local | gemma-3-270m-it-Q8_0         |  292 | few-shot     | on      | 163 |      0.0% |       100.0% |   32.5% |        50.3% |     4.9% |        0.072 |   0.528 |     0.108 |         0.217 |         12.5% | 0.74 s | $0.0000 |
| local | gemma-3-270m-it-Q8_0         |  292 | zero-shot    | off     | 163 |      0.0% |         0.0% |    0.0% |         0.0% |     0.0% |        0.000 |   0.000 |     0.000 |         0.000 |             – | 0.72 s | $0.0000 |
| local | gemma-3-270m-it-Q8_0         |  292 | zero-shot    | on      | 163 |      0.0% |        99.4% |   17.8% |        57.1% |     4.9% |        0.677 |   0.059 |     0.095 |         0.000 |         19.7% | 1.77 s | $0.0000 |
| local | granite-4.0-h-350m-Q8_0      |  366 | few-shot     | on      | 163 |      3.1% |       100.0% |   21.5% |        66.9% |    85.3% |        0.861 |   0.804 |     0.800 |         0.838 |          2.4% | 2.79 s | $0.0000 |
| local | granite-4.0-h-350m-Q8_0      |  366 | zero-shot    | on      | 163 |      0.6% |       100.0% |   35.6% |        68.1% |    43.6% |        0.850 |   0.726 |     0.658 |         0.286 |          4.4% | 3.55 s | $0.0000 |
| local | LFM2-350M-Extract-Q8_0       |  379 | few-shot     | on      | 163 |      0.0% |        73.0% |   18.4% |        41.7% |    57.1% |        0.413 |   0.370 |     0.200 |         0.124 |         32.1% | 2.69 s | $0.0000 |
| local | LFM2-350M-Extract-Q8_0       |  379 | zero-shot    | off     | 163 |      0.0% |         0.0% |    0.0% |         0.0% |     0.0% |        0.000 |   0.000 |     0.000 |         0.000 |             – | 1.55 s | $0.0000 |
| local | LFM2-350M-Extract-Q8_0       |  379 | zero-shot    | on      | 163 |      0.0% |        84.0% |   17.2% |        50.9% |    67.5% |        0.630 |   0.318 |     0.254 |         0.179 |         26.4% | 2.22 s | $0.0000 |
| local | LFM2.5-350M-Q8_0             |  379 | few-shot     | on      | 163 |      1.2% |       100.0% |   33.7% |        70.6% |    84.7% |        0.815 |   0.714 |     0.667 |         0.562 |          2.2% | 1.14 s | $0.0000 |
| local | LFM2.5-350M-Q8_0             |  379 | few-shot-v2  | on      | 163 |      0.0% |        99.4% |   26.4% |        69.3% |    84.0% |        0.774 |   0.701 |     0.686 |         0.418 |          2.7% | 1.02 s | $0.0000 |
| local | LFM2.5-350M-Q8_0             |  379 | zero-shot    | off     | 163 |      0.0% |         0.0% |    0.0% |         0.0% |     0.0% |        0.000 |   0.000 |     0.000 |         0.000 |             – | 1.41 s | $0.0000 |
| local | LFM2.5-350M-Q8_0             |  379 | zero-shot    | on      | 163 |      0.0% |        93.9% |   14.7% |        63.2% |    79.1% |        0.759 |   0.347 |     0.497 |         0.000 |         12.6% | 1.55 s | $0.0000 |
| local | LFM2.5-350M-Q8_0             |  379 | zero-shot-v2 | on      | 163 |      0.0% |        82.8% |   33.1% |        54.6% |    68.1% |        0.673 |   0.321 |     0.363 |         0.213 |         15.0% | 1.47 s | $0.0000 |
| local | Qwen3-0.6B-Q4_K_M            |  397 | few-shot     | on      | 163 |      1.8% |       100.0% |   39.3% |        81.6% |    81.0% |        0.854 |   0.801 |     0.517 |         0.495 |          1.8% | 1.89 s | $0.0000 |
| local | Qwen3-0.6B-Q4_K_M            |  397 | zero-shot    | off     | 163 |      0.0% |         1.2% |    1.2% |         1.2% |     1.2% |        0.000 |   0.015 |     0.000 |         0.000 |             – | 1.85 s | $0.0000 |
| local | Qwen3-0.6B-Q4_K_M            |  397 | zero-shot    | on      | 163 |      0.0% |        98.2% |   26.4% |        72.4% |    82.8% |        0.883 |   0.352 |     0.716 |         0.806 |          3.9% | 2.81 s | $0.0000 |
| local | LFM2-1.2B-Extract-Q4_K_M     |  731 | few-shot     | on      | 163 |      0.6% |        97.5% |   28.8% |        44.8% |    16.6% |        0.529 |   0.434 |     0.182 |         0.248 |         36.0% | 3.60 s | $0.0000 |
| local | LFM2-1.2B-Extract-Q4_K_M     |  731 | zero-shot    | on      | 163 |      0.0% |        96.3% |   19.6% |        57.1% |    88.3% |        0.675 |   0.387 |     0.221 |         0.275 |         16.8% | 4.55 s | $0.0000 |
| local | LFM2.5-1.2B-Instruct-Q4_K_M  |  731 | few-shot     | on      | 163 |      7.4% |       100.0% |   47.2% |        84.0% |    88.3% |        0.925 |   0.848 |     0.470 |         0.933 |          1.7% | 2.15 s | $0.0000 |
| local | LFM2.5-1.2B-Instruct-Q4_K_M  |  731 | zero-shot    | on      | 163 |      0.6% |        98.8% |   38.0% |        79.1% |    83.4% |        0.911 |   0.470 |     0.372 |         0.830 |          9.9% | 3.62 s | $0.0000 |
| local | Llama-3.2-1B-Instruct-Q4_K_M |  808 | few-shot     | on      | 163 |     10.4% |       100.0% |   71.2% |        79.8% |    96.9% |        0.764 |   0.870 |     0.886 |         0.926 |          2.0% | 2.24 s | $0.0000 |
| local | Llama-3.2-1B-Instruct-Q4_K_M |  808 | few-shot-v2  | on      | 163 |     12.9% |        99.4% |   74.2% |        77.3% |    94.5% |        0.773 |   0.839 |     0.843 |         0.887 |          3.1% | 1.90 s | $0.0000 |
| local | Llama-3.2-1B-Instruct-Q4_K_M |  808 | zero-shot    | off     | 163 |      0.0% |         0.0% |    0.0% |         0.0% |     0.0% |        0.000 |   0.000 |     0.000 |         0.000 |             – | 2.30 s | $0.0000 |
| local | Llama-3.2-1B-Instruct-Q4_K_M |  808 | zero-shot    | on      | 163 |      0.0% |       100.0% |    0.0% |        78.5% |    85.3% |        0.828 |   0.500 |     0.591 |         0.610 |          6.0% | 3.51 s | $0.0000 |
| local | Llama-3.2-1B-Instruct-Q4_K_M |  808 | zero-shot-v2 | on      | 163 |      0.0% |        99.4% |   71.8% |        79.1% |    85.9% |        0.732 |   0.559 |     0.538 |         0.543 |          6.0% | 3.04 s | $0.0000 |
| local | Qwen3-1.7B-Q4_K_M            | 1107 | few-shot     | on      | 163 |     13.5% |       100.0% |   68.7% |        93.9% |   100.0% |        0.957 |   0.861 |     0.896 |         0.922 |          1.5% | 3.45 s | $0.0000 |
| local | Qwen3-1.7B-Q4_K_M            | 1107 | few-shot-v2  | on      | 163 |     19.0% |       100.0% |   76.1% |        92.0% |   100.0% |        0.945 |   0.869 |     0.910 |         0.897 |          1.3% | 3.22 s | $0.0000 |
| local | Qwen3-1.7B-Q4_K_M            | 1107 | zero-shot    | off     | 163 |      0.0% |         1.8% |    0.6% |         1.2% |     1.8% |        0.000 |   0.045 |     0.000 |         0.033 |             – | 3.07 s | $0.0000 |
| local | Qwen3-1.7B-Q4_K_M            | 1107 | zero-shot    | on      | 163 |      9.2% |       100.0% |   65.0% |        92.0% |    96.3% |        0.965 |   0.756 |     0.878 |         0.992 |          0.9% | 5.45 s | $0.0000 |
| local | Qwen3-1.7B-Q4_K_M            | 1107 | zero-shot-v2 | on      | 163 |      5.5% |       100.0% |   69.9% |        92.6% |    94.5% |        0.950 |   0.716 |     0.759 |         0.992 |          1.3% | 4.37 s | $0.0000 |
| cloud | gemini-3.8-flash-high        |    – | zero-shot    | on      | 163 |     80.4% |       100.0% |   97.5% |       100.0% |   100.0% |        0.998 |   0.992 |     0.918 |         0.983 |          0.0% |      – |       – |
| cloud | gemini-3.8-flash-high        |    – | zero-shot-v2 | on      | 163 |     92.6% |       100.0% |  100.0% |       100.0% |   100.0% |        0.998 |   0.994 |     0.964 |         0.983 |          0.0% |      – |       – |

</details>

<details><summary>Full table: every run on dev</summary>

| Rung  | Model                        |   MB | Prompt       | Grammar |   n | Zero-edit | Schema-valid | jobType | laborMinutes | Approved | Materials F1 | Work F1 | Issues F1 | Follow-ups F1 | Hallucination |    p50 |  $/note |
| ----- | ---------------------------- | ---: | ------------ | ------- | --: | --------: | -----------: | ------: | -----------: | -------: | -----------: | ------: | --------: | ------------: | ------------: | -----: | ------: |
| rules | rules-legacy-v0              |    – | -            | –       | 110 |      0.9% |       100.0% |   38.2% |        67.3% |    38.2% |        0.378 |   0.327 |     0.000 |         0.067 |          3.3% | 0.00 s | $0.0000 |
| local | SmolLM2-135M-Instruct-Q8_0   |  145 | few-shot     | on      | 110 |      0.0% |        98.2% |   14.5% |        63.6% |     6.4% |        0.183 |   0.506 |     0.083 |         0.073 |         13.5% | 0.46 s | $0.0000 |
| local | SmolLM2-135M-Instruct-Q8_0   |  145 | zero-shot    | off     | 110 |      0.0% |         0.0% |    0.0% |         0.0% |     0.0% |        0.000 |   0.000 |     0.000 |         0.000 |             – | 2.57 s | $0.0000 |
| local | SmolLM2-135M-Instruct-Q8_0   |  145 | zero-shot    | on      | 110 |      0.0% |         1.8% |    0.0% |         0.9% |     0.9% |        0.045 |   0.033 |     0.043 |         0.000 |          0.0% | 2.81 s | $0.0000 |
| local | LFM2.5-350M-QAD-Q4_0         |  219 | few-shot     | on      | 110 |      3.6% |       100.0% |   25.5% |        70.9% |    85.5% |        0.891 |   0.704 |     0.592 |         0.373 |          2.1% | 0.73 s | $0.0000 |
| local | LFM2.5-350M-QAD-Q4_0         |  219 | zero-shot    | on      | 110 |      0.0% |        94.5% |   20.9% |        64.5% |    81.8% |        0.810 |   0.364 |     0.295 |         0.000 |          8.9% | 0.90 s | $0.0000 |
| local | LFM2.5-230M-Q8_0             |  247 | few-shot     | on      | 110 |      0.9% |        99.1% |   30.9% |        69.1% |    65.5% |        0.772 |   0.625 |     0.551 |         0.348 |          7.3% | 0.86 s | $0.0000 |
| local | LFM2.5-230M-Q8_0             |  247 | zero-shot    | on      | 110 |      0.0% |       100.0% |   32.7% |        64.5% |    85.5% |        0.866 |   0.362 |     0.347 |         0.389 |          5.1% | 1.00 s | $0.0000 |
| local | gemma-3-270m-it-Q8_0         |  292 | few-shot     | on      | 110 |      0.0% |       100.0% |   32.7% |        58.2% |     6.4% |        0.044 |   0.520 |     0.083 |         0.221 |         10.0% | 0.65 s | $0.0000 |
| local | gemma-3-270m-it-Q8_0         |  292 | zero-shot    | off     | 110 |      0.0% |         0.0% |    0.0% |         0.0% |     0.0% |        0.000 |   0.000 |     0.000 |         0.000 |             – | 0.78 s | $0.0000 |
| local | gemma-3-270m-it-Q8_0         |  292 | zero-shot    | on      | 110 |      0.0% |        99.1% |   20.0% |        65.5% |     6.4% |        0.742 |   0.077 |     0.094 |         0.000 |         16.4% | 1.55 s | $0.0000 |
| local | granite-4.0-h-350m-Q8_0      |  366 | few-shot     | on      | 110 |      0.9% |        99.1% |   20.9% |        70.9% |    80.9% |        0.900 |   0.823 |     0.738 |         0.820 |          1.3% | 2.98 s | $0.0000 |
| local | granite-4.0-h-350m-Q8_0      |  366 | zero-shot    | on      | 110 |      0.0% |       100.0% |   31.8% |        70.0% |    47.3% |        0.884 |   0.719 |     0.564 |         0.333 |          2.7% | 3.63 s | $0.0000 |
| local | LFM2-350M-Extract-Q8_0       |  379 | few-shot     | on      | 110 |      0.0% |        69.1% |   18.2% |        36.4% |    53.6% |        0.523 |   0.358 |     0.137 |         0.099 |         24.8% | 2.76 s | $0.0000 |
| local | LFM2-350M-Extract-Q8_0       |  379 | zero-shot    | off     | 110 |      0.0% |         0.0% |    0.0% |         0.0% |     0.0% |        0.000 |   0.000 |     0.000 |         0.000 |             – | 1.47 s | $0.0000 |
| local | LFM2-350M-Extract-Q8_0       |  379 | zero-shot    | on      | 110 |      0.0% |        80.9% |   18.2% |        51.8% |    61.8% |        0.675 |   0.281 |     0.176 |         0.137 |         21.7% | 2.17 s | $0.0000 |
| local | LFM2.5-350M-Q8_0             |  379 | few-shot     | on      | 110 |      0.9% |       100.0% |   32.7% |        78.2% |    85.5% |        0.863 |   0.735 |     0.619 |         0.505 |          0.7% | 1.29 s | $0.0000 |
| local | LFM2.5-350M-Q8_0             |  379 | few-shot-v2  | on      | 110 |      1.8% |       100.0% |   29.1% |        75.5% |    85.5% |        0.844 |   0.710 |     0.631 |         0.385 |          0.0% | 1.10 s | $0.0000 |
| local | LFM2.5-350M-Q8_0             |  379 | zero-shot    | off     | 110 |      0.0% |         0.0% |    0.0% |         0.0% |     0.0% |        0.000 |   0.000 |     0.000 |         0.000 |             – | 1.63 s | $0.0000 |
| local | LFM2.5-350M-Q8_0             |  379 | zero-shot    | on      | 110 |      0.0% |        94.5% |   17.3% |        70.0% |    80.0% |        0.786 |   0.361 |     0.386 |         0.000 |         10.3% | 1.42 s | $0.0000 |
| local | LFM2.5-350M-Q8_0             |  379 | zero-shot-v2 | on      | 110 |      0.0% |        86.4% |   33.6% |        64.5% |    73.6% |        0.723 |   0.340 |     0.261 |         0.273 |         11.1% | 1.45 s | $0.0000 |
| local | Qwen3-0.6B-Q4_K_M            |  397 | few-shot     | on      | 110 |      1.8% |        99.1% |   39.1% |        83.6% |    85.5% |        0.899 |   0.778 |     0.645 |         0.394 |          1.2% | 2.33 s | $0.0000 |
| local | Qwen3-0.6B-Q4_K_M            |  397 | zero-shot    | off     | 110 |      1.8% |         5.5% |    3.6% |         4.5% |     4.5% |        0.000 |   0.065 |     0.000 |         0.067 |             – | 2.10 s | $0.0000 |
| local | Qwen3-0.6B-Q4_K_M            |  397 | zero-shot    | on      | 110 |      1.8% |        99.1% |   32.7% |        73.6% |    83.6% |        0.913 |   0.372 |     0.644 |         0.812 |          1.6% | 2.89 s | $0.0000 |
| local | LFM2-1.2B-Extract-Q4_K_M     |  731 | few-shot     | on      | 110 |      0.0% |       100.0% |   35.5% |        52.7% |    18.2% |        0.586 |   0.423 |     0.191 |         0.188 |         34.2% | 3.62 s | $0.0000 |
| local | LFM2-1.2B-Extract-Q4_K_M     |  731 | zero-shot    | on      | 110 |      0.0% |        96.4% |   22.7% |        63.6% |    90.9% |        0.752 |   0.362 |     0.169 |         0.211 |         13.5% | 4.56 s | $0.0000 |
| local | LFM2.5-1.2B-Instruct-Q4_K_M  |  731 | few-shot     | on      | 110 |      6.4% |       100.0% |   50.9% |        87.3% |    88.2% |        0.924 |   0.842 |     0.492 |         0.847 |          1.8% | 2.32 s | $0.0000 |
| local | LFM2.5-1.2B-Instruct-Q4_K_M  |  731 | zero-shot    | on      | 110 |      0.0% |       100.0% |   45.5% |        80.9% |    85.5% |        0.904 |   0.474 |     0.288 |         0.806 |          8.8% | 3.84 s | $0.0000 |
| local | Llama-3.2-1B-Instruct-Q4_K_M |  808 | few-shot     | on      | 110 |     19.1% |       100.0% |   77.3% |        82.7% |    96.4% |        0.801 |   0.866 |     0.881 |         0.933 |          0.4% | 2.12 s | $0.0000 |
| local | Llama-3.2-1B-Instruct-Q4_K_M |  808 | few-shot-v2  | on      | 110 |     18.2% |       100.0% |   80.9% |        82.7% |    97.3% |        0.781 |   0.877 |     0.846 |         0.885 |          1.2% | 1.84 s | $0.0000 |
| local | Llama-3.2-1B-Instruct-Q4_K_M |  808 | zero-shot    | off     | 110 |      0.0% |         0.0% |    0.0% |         0.0% |     0.0% |        0.000 |   0.000 |     0.000 |         0.000 |             – | 2.14 s | $0.0000 |
| local | Llama-3.2-1B-Instruct-Q4_K_M |  808 | zero-shot    | on      | 110 |      0.0% |        99.1% |    0.0% |        86.4% |    85.5% |        0.849 |   0.611 |     0.448 |         0.542 |          3.9% | 3.43 s | $0.0000 |
| local | Llama-3.2-1B-Instruct-Q4_K_M |  808 | zero-shot-v2 | on      | 110 |      0.9% |        99.1% |   77.3% |        82.7% |    83.6% |        0.790 |   0.593 |     0.500 |         0.403 |          6.4% | 3.22 s | $0.0000 |
| local | Qwen3-1.7B-Q4_K_M            | 1107 | few-shot     | on      | 110 |     26.4% |       100.0% |   70.9% |        94.5% |   100.0% |        0.971 |   0.905 |     0.880 |         0.915 |          0.0% | 3.21 s | $0.0000 |
| local | Qwen3-1.7B-Q4_K_M            | 1107 | few-shot-v2  | on      | 110 |     29.1% |       100.0% |   80.9% |        93.6% |   100.0% |        0.960 |   0.862 |     0.909 |         0.836 |          0.6% | 3.43 s | $0.0000 |
| local | Qwen3-1.7B-Q4_K_M            | 1107 | zero-shot    | off     | 110 |      0.9% |         2.7% |    0.9% |         2.7% |     2.7% |        0.000 |   0.045 |     0.000 |         0.067 |             – | 3.07 s | $0.0000 |
| local | Qwen3-1.7B-Q4_K_M            | 1107 | zero-shot    | on      | 110 |      7.3% |       100.0% |   66.4% |        93.6% |    96.4% |        0.971 |   0.743 |     0.792 |         0.982 |          0.0% | 4.15 s | $0.0000 |
| local | Qwen3-1.7B-Q4_K_M            | 1107 | zero-shot-v2 | on      | 110 |      7.3% |       100.0% |   75.5% |        94.5% |    97.3% |        0.960 |   0.710 |     0.631 |         0.982 |          0.9% | 4.37 s | $0.0000 |
| cloud | gemini-3.8-flash-high        |    – | zero-shot    | on      | 110 |     88.2% |       100.0% |  100.0% |       100.0% |   100.0% |        0.994 |   1.000 |     0.933 |         1.000 |          0.0% |      – |       – |
| cloud | gemini-3.8-flash-high        |    – | zero-shot-v2 | on      | 110 |     97.3% |       100.0% |  100.0% |       100.0% |   100.0% |        1.000 |   0.997 |     0.988 |         1.000 |          0.0% |      – |       – |

</details>
