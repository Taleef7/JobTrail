# Data card: JobTrail eval sets v1

Frozen 2026-10-03 (#71). Files: [`data/test.jsonl`](../data/test.jsonl) (163 records) and [`data/dev.jsonl`](../data/dev.jsonl) (110 records). Their SHA-256 are in [`data/FROZEN.md`](../data/FROZEN.md), and CI fails if either file changes.

## What it is

Each record is a tradesperson's end-of-job note with a schema-v2 answer key (`jobType`, `workPerformed`, `issuesFound`, `materials`, `laborMinutes`, `customerApproved`, `followUps`). The sets measure how well an extraction model turns notes into job records.

- **test:** for final numbers only. Never trained or tuned on.
- **dev:** for prompt and model iteration and error analysis.

Format: [`data/README.md`](../data/README.md). Labeling rules: [`data/LABELING.md`](../data/LABELING.md). Metrics: [`packages/core/SCORING.md`](../packages/core/SCORING.md).

## How the notes were made (#70)

All notes are **synthetic**, generated record-first. A seeded sampler (`ml/jobtrail_ml/sampler.py`) draws each answer key from job templates in `data/scenarios.yaml`:

- 9 trades × 4 note styles (terse, rambling, spoken with fillers, plain);
- 8 hard-case tags: hours phrasing, negation, self-correction, multiple materials, no materials, supply-house trip, extra labor, approval absent.

A teacher model (`gemini-3.6-flash`) then wrote a note that must state exactly that record. The key is therefore the plan, not a model's reading of its own prose. Every draft also had fidelity checks:

- rule checks that each material, quantity and time is in the note;
- a blind cross-check, in which a different model (`gemini-3.1-flash-lite`) extracted the note and disagreements were flagged.

## How the keys were checked (#71)

**No human verified these labels.** The owner first planned to review flagged drafts by hand in [`/label/`](https://jobtrail-drab.vercel.app/label/). On 2026-10-02 they decided against it (not a domain expert) and asked for a model review instead. Every record therefore has `verified: false` and `review.method: "adjudicated"`.

The checks, in order:

1. **Fidelity flags (#70):** 66 of 275 drafts.
2. **Claude panel (#71 step 1):** Sonnet 5.5, Opus 5.5 and Fable 5.1 each checked every draft blind. 17 drafts were questioned. Step 1 was meant to pick drafts for the owner's review.
3. **Cross-family adjudication (#71 step 2):** every draft was reviewed again under `LABELING.md`. Each reviewer answered **accept**, **edit** (the full corrected key) or **reject** (the note is ambiguous), and was shown the earlier flags as concerns that might be wrong.
   - **Gemini 3.8 Flash (High)**, via the Antigravity CLI, reviewed all 275.
   - **Claude Opus 5.5**, via subagents, reviewed all 275, one batch per agent.
   - **GPT-OSS 120B** (OpenAI, open weights), via Antigravity, reviewed only the 5 drafts the first two left unsettled.
   - **The rule:** a key is final when two reviewers agree on it, where "agree" is the scorer's own zero-edit test in both directions. Two rejects, or no two reviewers agreeing, reject the note. Under a two-of-three rule a third vote can't change a draft two reviewers already agree on, so GPT-OSS only broke ties.
   - **Pre-registration:** the rule was committed before any vote (`ml/jobtrail_ml/adjudicate.py`; tests in `ml/tests/test_adjudicate.py`). Votes, batches and decisions are in [`data/review/adjudication/`](../data/review/adjudication/).

**A pilot changed three rules before the full run.** A one-batch pilot showed one reviewer reading three rules literally where the drafts followed a convention, so `LABELING.md` was clarified:

- the job's own task is not also an issue found;
- an item named only as the object of a task, with no number, is not a material;
- length is always `feet`.

The pilot votes are kept in `data/review/adjudication/pilot/`.

**Reviewer changes, made before any decision was computed** (they follow the owner's subscription limits):

- Partial runs by `gemini-3.1-pro-high` (15 of 23 batches) and `gpt-6-astra` (11 of 23 batches) were stopped. Their votes are kept in `superseded/` and not used.
- The owner wanted GPT through Codex sparingly and didn't want to wait for its quota, so the tie-breaker is GPT-OSS via Antigravity.

## Results

From [`data/review/stats.json`](../data/review/stats.json) and [`data/review/adjudication/stats.json`](../data/review/adjudication/stats.json):

| Drafts                            |   n | Kept as drafted | Key corrected | Rejected |
| --------------------------------- | --: | --------------: | ------------: | -------: |
| All                               | 275 |             259 |            14 |        2 |
| With a fidelity flag (#70)        |  66 |              54 |            11 |        1 |
| Questioned by the Claude panel    |  17 |               3 |            12 |        2 |
| Clean (no flag, no panel problem) | 205 |             204 |             1 |        0 |

The flagged and questioned groups overlap.

- **Teacher error rate.** 16 of 275 drafts (5.8%) were wrong or ambiguous: 14 keys corrected and 2 notes rejected.
  - Among the 205 drafts no earlier check flagged, 1 changed (0.5%, 95% Wilson interval 0.1–2.7%). Drafts that pass the fidelity checks and the panel are almost always right.
- **Fields corrected:** `workPerformed` 9, `issuesFound` 3, `materials` 2, `followUps` 1. The common error was a fix the note narrates but the key lacks: the teacher wrote "put down roofing cement to fix the lifted shingles" into a plan that only listed the shingle replacement.
- **Rejected notes:**
  - t-0136 contradicts itself: it says cover plates were replaced and also that they weren't needed.
  - t-0021 split the reviewers on how many problems it reports.
- **Agreement.** Gemini and Claude agreed on 270 of 275 drafts without the tie-breaker. Each landed on the final key for at least 270 drafts: Gemini 272, Claude 270.
- **Split sizes.** Test went from 165 to 163 drafts (both rejects were test notes). Dev stayed at 110.

## Known limitations and biases

- **Synthetic only.** Every note was written by one Gemini model from a template. Real notes are messier: longer, less consistent, more trade slang, typos and speech-to-text errors. Scores here are an upper bound for real use. The spoken-note slice (#92) is the planned real-world check; it is reported separately.
- **No human ground truth.** The keys rest on the record-first plan plus model reviews. Several model families agreeing reduces errors but can't remove ones all of them share, such as a reading of `LABELING.md` that every model makes the same way.
- **Gemini runs through the pipeline.** Gemini models wrote the notes, cross-checked them, and cast one of the two main votes. Gemini 3.8 Flash, the cloud ceiling in #73, reviewed the keys it will later be graded against. Gemini phrasing may suit Gemini extraction.
  - #73 will also report the ceiling on the drafts where the Claude vote alone matches the final key, and compare.
- **Narrow scope.**
  - English; US-style residential trades; 9 trades.
  - Notes run 1–8 sentences (78–527 characters), and one job per note.
  - Quantities are whole numbers from 1 to 30. Prices and customer names are absent by design.
- **The rules are conventions.** Some labels follow `LABELING.md` choices a reader could dispute: whether the job's reason is an "issue", task objects as materials, `feet`. Models are prompted with the same rules (`ml/jobtrail_ml/extract.py`), so this measures following them.
- **Tag balance.** Each hard-case tag has at least 24 test drafts. That is enough to see large per-tag differences, not small ones.

## Reproduce

From `ml/`:

```bash
uv run python scripts/adjudicate.py decide     # votes -> decisions.jsonl, stats.json
uv run python scripts/freeze_eval.py           # decisions -> test.jsonl, dev.jsonl, FROZEN.md
uv run pytest tests/test_frozen.py              # the CI freeze check
```

The decisions are deterministic given the committed votes. The votes themselves came from models and would differ if re-collected.
