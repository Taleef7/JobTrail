---
license: other
license_name: lfm1.0
license_link: LICENSE
base_model: LiquidAI/LFM2.5-350M
base_model_relation: finetune
datasets:
  - taleef/jobtrail-field-notes
language:
  - en
pipeline_tag: text-generation
tags:
  - gguf
  - llama.cpp
  - structured-output
  - information-extraction
  - on-device
---

# JobTrail LFM2.5-350M (GGUF)

A 350M-parameter model that turns a tradesperson's job note into a structured job record, small enough to run offline on a phone CPU. It is [LiquidAI/LFM2.5-350M](https://huggingface.co/LiquidAI/LFM2.5-350M) fine-tuned with LoRA on 760 synthetic field notes ([taleef/jobtrail-field-notes](https://huggingface.co/datasets/taleef/jobtrail-field-notes)), for the [JobTrail](https://github.com/Taleef7/JobTrail) app.

**Input:** the note alone, as a single user message (no system prompt).
**Output:** one JSON object with short keys:

```json
{
  "t": "roofing",
  "w": ["Replaced missing shingles"],
  "i": ["lifted shingles along the ridge line"],
  "m": [{ "n": "roofing cement", "q": null, "u": null }],
  "l": 90,
  "a": true,
  "f": ["Inspect again after the next storm"]
}
```

`t` jobType (one of 9 trades: plumbing, electrical, hvac, carpentry, appliance, cleaning, painting, roofing, general), `w` workPerformed, `i` issuesFound, `m` materials (`n` name, `q` quantity, `u` unit), `l` laborMinutes, `a` customerApproved, `f` followUps. The JSON Schema is [`schema.v2.compact.json`](https://huggingface.co/taleef/jobtrail-lfm2.5-350m-GGUF/blob/main/schema.v2.compact.json); pass it as a grammar.

## Files

| File                                   |       Size | Test zero-edit | Held-out templates |   Peak RAM |  p50 (CPU) |
| -------------------------------------- | ---------: | -------------: | -----------------: | ---------: | ---------: |
| `jobtrail-lfm2.5-350m-F16.gguf`        |     711 MB |          73.6% |              23/49 |     853 MB |     1.56 s |
| `jobtrail-lfm2.5-350m-Q8_0.gguf`       |     379 MB |          73.6% |              23/49 |     536 MB |     0.91 s |
| `jobtrail-lfm2.5-350m-Q6_K.gguf`       |     293 MB |          73.0% |              24/49 |     454 MB |     0.71 s |
| **`jobtrail-lfm2.5-350m-Q4_K_M.gguf`** | **229 MB** |      **70.6%** |          **24/49** | **394 MB** | **0.57 s** |
| `jobtrail-lfm2.5-350m-Q4_0.gguf`       |     219 MB |          65.6% |              20/49 |     384 MB |     0.59 s |

All quants come from the F16 export, made with llama.cpp b9837 (`convert_hf_to_gguf.py`, then `llama-quantize`). **Q4_K_M** is the app's default; Q4_0 loses 5 points for almost no size saving.

Numbers are on the JobTrail test set (163 notes), with the grammar on, temperature 0, and llama-server b9837 on CPU only (ctx 4096). p50 is wall time per note on a Ryzen 9 8940HX laptop; phones are slower (JobTrail #77 measures them). Peak RAM is llama-server's peak working set on the longest test note.

## Usage

```bash
llama-server -m jobtrail-lfm2.5-350m-Q4_K_M.gguf -c 4096
```

```bash
curl http://127.0.0.1:8080/v1/chat/completions -H "Content-Type: application/json" -d '{
  "messages": [{"role": "user", "content": "Replaced the wax ring on the upstairs toilet, about an hour. Customer okayed it."}],
  "temperature": 0,
  "response_format": {"type": "json_schema", "json_schema": {"schema": SCHEMA}}
}'
```

Replace `SCHEMA` with the contents of `schema.v2.compact.json`. The chat template is the base model's and is embedded in the GGUF.

## Evaluation (test, n = 163)

**"Zero-edit"** means the whole record is right: every field matches the reviewed gold after JobTrail's scorer ([SCORING.md](https://github.com/Taleef7/JobTrail/blob/main/packages/core/SCORING.md)).

| Model                                     |       Size | Test zero-edit |
| ----------------------------------------- | ---------: | -------------: |
| This model, Q4_K_M                        |     229 MB |      **70.6%** |
| LFM2.5-350M, prompted (best of 4 prompts) | 219–379 MB |           1.2% |
| Qwen3-1.7B, prompted (few-shot)           |     1.1 GB |          19.0% |
| Gemini 3.8 Flash High (cloud ceiling)     |          – |          92.6% |

**Field scores, Q4_K_M:**

- jobType 89.0%
- laborMinutes 96.3%
- customerApproved 100%
- materials F1 0.989 (quantity right on 99.1% of matched materials)
- workPerformed F1 0.953
- issuesFound F1 0.959
- followUps F1 0.966
- hallucinated values 0%

All 163 outputs were valid JSON with the grammar on. Without it, 96.9–100% were valid, depending on the quant.

**By slice, Q4_K_M zero-edit:**

- **Notes from job templates seen in training (114):** 79.8%.
- **Notes from the 9 job templates held out of training (49):** 49.0%.
- **Hard-case tags:**
  - approval-absent 80.0%
  - hours phrasing 80.0%
  - negation 79.2%
  - no materials 76.0%
  - self-correction 72.0%
  - multiple materials 66.7%
  - extra labor 53.8%
  - supply-house trip 50.0%

## Limitations and failure taxonomy

- **The trade on unfamiliar jobs.** It is the main failure: 18 of the 48 Q4_K_M failures on test are the trade, and all 18 come from held-out job templates. The model learned which trade goes with the jobs it saw. On a new kind of job it often picks a neighbouring trade:
  - carpentry → general (5)
  - painting → cleaning (3)
  - appliance → plumbing (2)
  - hvac → plumbing (2)
- **Work-performed items.** 18 failures. Most are a missed item: 9 only miss one, 4 only add one, and 5 do both.
- **Materials.** 12 failures: a missed or extra material, or a wrong quantity or unit.
- **Labour minutes.** 6 failures. Two carry the extra-labor tag and two the hours-phrasing tag.
- **Synthetic data.** The training and test notes were written by Gemini 3.8 Flash from templates, and their labels were model-reviewed, not human-verified. Real dictated notes are messier. JobTrail reports a spoken-note slice separately when it exists.
- **English only, nine trades, one person's job.** It is not a general extractor; anything outside the schema is dropped.
- **The model can be wrong with confidence.** The app shows every field for review before anything is saved or billed.

## Training

- **Method:** LoRA on all linear layers (r 16, alpha 32, dropout 0.05), merged into the base weights. Learning rate 2e-4 with a cosine schedule and 5% warmup, 3 epochs, effective batch 16, loss on the completion only.
- **Data:** 760 training notes plus 39 validation notes, from the 799 kept notes in the dataset's `default` configuration.
- **Run:** 67 s on one RTX 5070 Ti Laptop GPU, with PyTorch 2.14.1 (CUDA 13.0), transformers 5.22.0, TRL 1.17.0 and PEFT 0.21.2.
- **Reproducing:** the config, logs and loss curve are in [`results/train/lfm2.5-350m-lora`](https://github.com/Taleef7/JobTrail/tree/main/results/train/lfm2.5-350m-lora). The model choice and the comparison against Granite 4.0-H-350M, Qwen3-0.6B and others are in [RESULTS.md](https://github.com/Taleef7/JobTrail/blob/main/docs/RESULTS.md).

## Licence

This is a derivative of LFM2.5-350M and is released under the **LFM Open License v1.0** ([LICENSE](https://huggingface.co/taleef/jobtrail-lfm2.5-350m-GGUF/blob/main/LICENSE)), which permits commercial use below the US$10M annual-revenue threshold set out in the licence. The training data is MIT-licensed and was generated with Gemini.
