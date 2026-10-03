# Data card: JobTrail eval sets v1

Frozen 2026-10-03 (#71). Files: [`data/test.jsonl`](../data/test.jsonl) (163 records) and [`data/dev.jsonl`](../data/dev.jsonl) (110 records). Their SHA-256 are in [`data/FROZEN.md`](../data/FROZEN.md), and CI fails if either file changes.

## What it is

Each record is a tradesperson's end-of-job note with a schema-v2 answer key (`jobType`, `workPerformed`, `issuesFound`, `materials`, `laborMinutes`, `customerApproved`, `followUps`). The sets measure how well an extraction model turns notes into job records.

- **test:** for final numbers only. Never trained or tuned on.
- **dev:** for prompt and model iteration and error analysis.

Format: [`data/README.md`](../data/README.md). Labeling rules: [`data/LABELING.md`](../data/LABELING.md). Metrics: [`packages/core/SCORING.md`](../packages/core/SCORING.md).

## How the notes were made (#70)

All notes are **synthetic**, generated record-first. A seeded sampler (`ml/jobtrail_ml/sampler.py`) draws each answer key from job templates in `data/scenarios.yaml`:

- 9 trades;
- 4 note styles: `terse`, `rambling`, `spoken-fillers` and `run-on`;
- 8 hard-case tags: hours phrasing, negation, self-correction, multiple materials, no materials, supply-house trip, extra labor, approval absent.

A teacher model (`gemini-3.6-flash`) then wrote a note that must state exactly that record. The key is therefore the plan, not a model's reading of its own prose. Every draft also had fidelity checks:

- rule checks that each material, quantity and time is in the note;
- a blind cross-check, in which a different model (`gemini-3.1-flash-lite`) extracted the note and disagreements were flagged.

## How the keys were checked (#71)

**No human verified these labels.** The owner first planned to review flagged drafts by hand in [`/label/`](https://jobtrail-drab.vercel.app/label/). On 2026-10-02 they decided against it (not a domain expert) and asked for a model review instead. Every record therefore has `verified: false` and `review.method: "adjudicated"`.

### Checks, in order

1. **Fidelity flags (#70):** 66 of 275 drafts.
2. **Claude panel (#71 step 1):** Sonnet 5.5, Opus 5.5 and Fable 5.1 each checked every draft blind. 17 drafts were questioned.
3. **Adjudication (#71 step 2).** Each reviewer answered **accept**, **edit** (the full corrected key) or **reject** (the note is ambiguous).
   - **What each reviewer saw:** the note, the draft key and its tags, plus "concerns": the fidelity flags and the panel's problem notes. Some of those notes were written by Opus 5.5, the same model as one adjudicator, and some propose a fix. Reviewers were told the concerns might be wrong.
   - **Who reviewed:**
     - **Gemini 3.8 Flash (High)** via the Antigravity CLI and **Claude Opus 5.5** via subagents each reviewed all 275 drafts.
     - **GPT-OSS 120B** (OpenAI, open weights) via Antigravity reviewed only the 5 drafts the first two left unsettled.
   - **Decision rule:** a key is final when two reviewers agree on it, where "agree" is the scorer's own zero-edit test in both directions. Two rejects, or no two reviewers agreeing, reject the note.
4. **One consistency fix after the vote:** the supply-house rule. See [below](#the-supply-house-rule).

### What was fixed in advance, and what changed later

All times are 2026-10-02, US Eastern, from git history and the vote files' timestamps.

- **20:07, before any vote:** the decision rule and code were committed (`b7a7d49`). That commit also named three reviewers meant to come from different families and to exclude any model the eval grades: GPT-6-Astra via Codex, Gemini 3.1 Pro, Claude Opus 5.5.
- **20:12, after a one-batch pilot:** three rules in `LABELING.md` were clarified. The pilot showed one reviewer reading them literally where the drafts followed a convention:
  - the job's own task is not also an issue found;
  - an item named only as the object of a task, with no number, is not a material;
  - length is always `feet`.

  The pilot votes are in `data/review/adjudication/pilot/`.

- **20:13:** all 23 Claude batches were voted.
- **20:34, after the Claude votes and partial runs by the other two:** the owner asked to use their subscriptions' cheaper models. Gemini 3.1 Pro (15 of 23 batches done) was replaced by **Gemini 3.8 Flash**, so the "no model the eval grades" rule no longer holds: Gemini 3.8 Flash is the cloud ceiling in #73. The GPT-6-Astra run (11 of 23 batches, stopped by Codex's usage limit) was set aside. Both partial runs are kept in `superseded/` and not used.
- **20:55, after the Gemini 3.8 Flash votes:** GPT's role became tie-breaker only, to save the owner's Codex quota. The 5 unsettled drafts were computed then. Under a two-of-three rule a third vote can't change a draft two reviewers already agree on.
- **21:22, after the 5 drafts were known but before any tie-break vote:** the tie-breaker became GPT-OSS 120B via Antigravity, instead of waiting hours for Codex.

### How much the reviewer swap mattered

On the 132 drafts that all three originally named reviewers covered, those reviewers would have produced a different final key for **10**. The comparison is in [`sensitivity.json`](../data/review/adjudication/sensitivity.json).

- **6 are supply-house parts.** The original reviewers removed a part the note only says was picked up; the final keys keep it. This is the [supply-house rule](#the-supply-house-rule) below. Applied to their keys, those 6 would match too.
- **4 are judgment calls:** 3 on `issuesFound` and 1 on a task's installed item.

So on that subset, the final keys depend on the choice of reviewers for about 3% of drafts, beyond the supply-house rule.

### The supply-house rule

A consistency check after the vote found the supply-house case labeled two ways. In 2 drafts (t-0102, t-0110), Gemini and Claude removed a part the note says was picked up at the supply house but never says was used. A panel concern had pointed them at it. In the other 39 supply-house drafts, the same reviewers kept the part.

`LABELING.md` now settles this the way 39 of 41 drafts already had it, and the way an invoice needs it: **a part picked up at the supply house for this job is a material, unless the note says it wasn't used.** The 2 decisions were overridden to restore the part. The reason is recorded in [`overrides.jsonl`](../data/review/adjudication/overrides.jsonl) and in each record's `review.override`. A CI test now checks every supply-house record.

## Results

From [`data/review/stats.json`](../data/review/stats.json) and [`data/review/adjudication/stats.json`](../data/review/adjudication/stats.json):

| Drafts                            |   n | Kept as drafted | Key corrected | Rejected |
| --------------------------------- | --: | --------------: | ------------: | -------: |
| All                               | 275 |             261 |            12 |        2 |
| With a fidelity flag (#70)        |  66 |              54 |            11 |        1 |
| Questioned by the Claude panel    |  17 |               5 |            10 |        2 |
| Clean (no flag, no panel problem) | 205 |             204 |             1 |        0 |

The flagged and questioned groups overlap.

- **Keys changed: 14 of 275 (5.1%):** 12 corrected and 2 notes rejected.
  - **9 corrections add a fix the note narrates but the key lacked.** For example, t-0001's writer added "I put down some roofing cement to tackle the issue" to a plan that only listed the shingle replacement.
  - **1 adds a pending task as a follow-up and its issue.**
  - **2 remove the job's own cause from `issuesFound`** ("Doorknob punched through the drywall"). These apply a rule clarified after the drafts were written, so they aren't teacher errors.
- **Rejected notes:**
  - t-0136 contradicts itself: it says cover plates were replaced and also that they weren't needed.
  - t-0021 split the reviewers on how many problems it reports.
- **Clean drafts:** of the 205 drafts no earlier check flagged, 1 changed (0.5%, 95% Wilson interval 0.1–2.7%). That one change is t-0049, which applies the post-draft rule. Clean drafts held up well under these reviewers. This depends on the reviewers chosen, as measured above.
- **Agreement:**
  - Gemini and Claude settled 270 of 275 drafts without the tie-breaker. Of the 5 tie-breaks, 4 settled and 1 (t-0021) stayed unresolved and was rejected.
  - On the final keys, Gemini's vote matches 270 and Claude's 268.
- **Split sizes:** test went from 165 to 163 drafts (both rejects were test notes). Dev stayed at 110.

## Known limitations and biases

- **Synthetic only.** Every note was written by one Gemini model from a template. Real notes are messier: longer, less consistent, more trade slang, typos and speech-to-text errors. Scores here are an upper bound for real use. The spoken-note slice (#92) is the planned real-world check; it is reported separately.
- **No human ground truth.** The keys rest on the record-first plan plus model reviews. Several model families agreeing reduces errors but can't remove ones all of them share, such as a reading of `LABELING.md` that every model makes the same way.
- **Gemini runs through the pipeline.** Gemini models wrote the notes, cross-checked them, and cast one of the two main votes. Gemini 3.8 Flash, the cloud ceiling in #73, reviewed the keys it will later be graded against. Gemini phrasing may suit Gemini extraction.
  - #73 will also report the ceiling on the drafts where Claude's vote alone matches the final key, and compare.
- **Reviewers saw earlier concerns.** These included the Claude panel's notes, so a panel opinion could carry over into the votes. The concerns were labeled as possibly wrong, and the supply-house case shows they could still steer a reviewer.
- **Narrow scope.**
  - English; US-style residential trades; 9 trades.
  - Notes run 1–8 sentences (78–527 characters), and one job per note.
  - Quantities are whole numbers from 1 to 30. Prices and customer names are absent by design.
- **The rules are conventions.** Some labels follow `LABELING.md` choices a reader could dispute: whether the job's reason is an "issue", task objects as materials, supply-house parts, `feet`. The extraction prompts in #72 restate these rules, so a score measures following them.
- **Tag balance.** Each hard-case tag has at least 24 test drafts. That is enough to see large per-tag differences, not small ones.

## Reproduce and check

From `ml/`. The decisions and the freeze are deterministic given the committed votes and overrides. Rebuilding into a scratch folder must give the same SHA-256 as `data/FROZEN.md`:

```bash
uv run python scripts/adjudicate.py decide                  # votes + overrides -> decisions.jsonl (same reviewedAt)
uv run python scripts/freeze_eval.py --out-dir /tmp/freeze   # never overwrites data/ (refuses without --refreeze)
sha256sum /tmp/freeze/test.jsonl /tmp/freeze/dev.jsonl       # = data/FROZEN.md
uv run python scripts/adjudicate.py sensitivity             # the reviewer-swap comparison above
```

The votes themselves came from models and would differ if re-collected.
