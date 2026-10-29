---
license: mit
language:
  - en
pretty_name: JobTrail field notes (synthetic training set v1)
size_categories:
  - n<1K
task_categories:
  - text-generation
tags:
  - synthetic
  - information-extraction
  - structured-output
configs:
  - config_name: default
    data_files:
      - split: train
        path: train.jsonl
  - config_name: raw
    data_files:
      - split: train
        path: raw.jsonl
---

# JobTrail field notes: synthetic training set v1

799 tradesperson end-of-job notes, each paired with a structured job record, for fine-tuning
a small on-device model to turn a note into a record. It's the training set of
[JobTrail](https://github.com/Taleef7/JobTrail) (issue #74). The frozen eval sets it was kept apart
from are in the same repository ([data card](https://github.com/Taleef7/JobTrail/blob/main/docs/DATA_CARD.md)).

**All of it is synthetic.** Gemini 3.8 Flash wrote and labeled every note, through the
Antigravity CLI. No real customer or job is in it. Google's terms for Gemini output apply in
addition to the MIT license, and OpenAI's to the 150 GPT-6 Luna cross-check labels in the `raw`
configuration.

## Configurations

- **`default`** (`train.jsonl`, 799 rows): the training set. Fields are `id`, `note`, `target`
  (the record), `trade`, `style`, `tags` and `source`.
- **`raw`** (`raw.jsonl`, 930 rows): every note of plans 1–930, kept or not, with its plan, the
  labels (`labels`, keyed by the models that labeled the note; `null` would mean an unparseable
  or invalid answer, and none is), `kept`, and why it was dropped (`reason`, `contradicts`).
  It's there to audit the filter or to build a different one.

`target` follows schema v2: `jobType`, `workPerformed`, `issuesFound`, `materials`
(`name`, `quantity`, `unit`), `laborMinutes`, `customerApproved` and `followUps`. A value the note
doesn't state is `null` or empty. The labeling rules are in
[`data/LABELING.md`](https://github.com/Taleef7/JobTrail/blob/main/data/LABELING.md).

Other files: `filter.json` (counts, mix and the SHA-256 of every data file), `leakage.json`,
`heldout.json`, `config.yaml` (every setting of the run) and `raw/`: the files the run appended
to, from which `filter` rebuilds everything above. They include every model answer and the time
and tokens of every call, and 30 notes written past plan 930 that v1 doesn't use.

## How it was made

1. **Plan.** A seeded sampler draws a record from the job templates in
   [`data/scenarios.yaml`](https://github.com/Taleef7/JobTrail/blob/main/data/scenarios.yaml): 9 trades,
   4 note styles (terse, rambling, spoken-fillers, run-on) and 8 hard-case tags (hours phrasing,
   negation, self-correction, multiple materials, no materials, supply-house trip, extra labor,
   approval absent). The tags that caused most baseline failures are weighted up, and no plan
   repeats an eval answer key. A plan may repeat in a different style: 7 plans appear twice among the kept notes. The
   plans are a fixed prefix (1–930) of a 6,000-plan pool, so a later, larger run adds notes
   without changing these.
2. **Write.** `gemini-3.8-flash-medium` writes each note from its plan in its own words, 15 at a
   time.
3. **Label, blind.** Two labelers read only the note: `gemini-3.8-flash-high` (97.3% zero-edit on
   the dev set with this prompt) and, separately, `gemini-3.8-flash-medium`. The target is the
   High label, so it uses the note's wording, not the plan's.
4. **Filter.** A note is kept only if:
   - both labels are valid;
   - they agree, under the JobTrail scorer's zero-edit test in both directions;
   - the target matches what the plan fixed: the trade, minutes and approval; the number of
     tasks, issues and follow-ups (not their wording); and the materials by quantity and unit
     (not by name). Up to one extra task per material is allowed, since the eval gold also lists
     narrated installs as tasks. One planned issue, "Doorknob punched through the drywall", may
     be left out, as the eval gold labels it both ways (`LABELING.md` reads it as the job's own
     task); 3 kept notes leave it out.
5. **Leakage check.** A kept note is dropped if it's a near-copy of any test or dev note: 5-word
   shingle Jaccard ≥ 0.2, or 8-gram containment ≥ 0.3. Both thresholds were set from the
   test-vs-dev distribution (95th percentiles 0.139 and 0.154) before any training note existed.

## Results

| Step                        | Notes           |
| --------------------------- | --------------- |
| Planned and written         | 930             |
| Labelers disagree           | −77             |
| Target contradicts the plan | −43             |
| Near-copy of an eval note   | −11             |
| **Kept**                    | **799** (85.9%) |

Of the 43 contradictions, the fields involved were materials 21, issues 18, tasks 18, trade 15,
minutes 15, approval 12 and follow-ups 11 (a note can break several).

Kept notes by style: terse 203, rambling 182, spoken-fillers 204, run-on 210. By trade: 74–109
each. Every hard-case tag has at least 86 kept notes; self-correction, the most common baseline
failure, has 188. The full mix is in `filter.json`.

**Cross-check, not part of the filter.** GPT-6 Luna (another model family, through the Codex CLI)
labeled the first 150 notes blind. On the 126 of them that were kept, its label agrees with the
target on 83 (66%) and keeps the plan facts on 98 (78%).

## Held-out templates

One job template per trade never reaches training. That way a fine-tuned model can be scored
separately on eval notes from templates it has never seen, to tell whether it learned the task or
the templates. The slice is 49 of the 163 test notes and 27 of the 110 dev notes; the ids are in
`heldout.json`.

| Trade      | Held-out template                  |
| ---------- | ---------------------------------- |
| appliance  | Replaced dishwasher drain pump     |
| carpentry  | Rehung sagging exterior door       |
| cleaning   | Deep cleaned kitchen               |
| electrical | Installed GFCI outlets in bathroom |
| general    | Assembled flat-pack wardrobe       |
| hvac       | Replaced blower motor capacitor    |
| painting   | Stained deck                       |
| plumbing   | Replaced toilet wax ring           |
| roofing    | Cleaned gutters                    |

## Limitations

- **Smaller than planned.** The issue asked for 3,000–5,000 kept notes. At about 43 s of model
  time per note (writing 7 s, Flash High labeling 22 s, Flash Medium 13 s, from the usage logs),
  the owner stopped at plans 1–930 and will add more only if fine-tuning shows it needs them.
- **One model family.** The writer and both labelers are Gemini 3.8 Flash, so the targets carry
  its reading of the labeling rules. The cross-check shows another family reads about a third
  of the notes differently.
- **Agreement isn't correctness.** Two labelers can agree on the same mistake. The plan check
  catches wrong numbers, trades and counts, but not wrong wording, material names or field
  routing.
- **Templates.** Outside the held-out ones, training and eval notes share job templates, and 442
  of the 810 notes checked share at least one 8-gram with an eval note (54 of the 110 dev notes do
  with test, too). Only near-copies were dropped.
- **No human reviewed it.**

## Reproduce

From the repository, in `ml/`:

```bash
uv run python scripts/gen_train_notes.py write
uv run python scripts/gen_train_notes.py label gemini
uv run python scripts/gen_train_notes.py label gemini-medium
uv run python scripts/gen_train_notes.py filter
```

The limit (930) comes from `config.yaml`. Every stage resumes where it stopped, and
`--shard K/N` splits a stage across processes. Model output isn't deterministic, so a rerun
writes different notes. Put this dataset's `raw/` files in `data/train/raw/` and `filter`
rebuilds `train.jsonl` and `raw.jsonl` byte for byte; `filter.json` records the SHA-256 of
both and of every raw file.
