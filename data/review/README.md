# data/review/ (#71)

How the 275 eval drafts were checked before `data/test.jsonl` and `data/dev.jsonl` were frozen. The full story, results and caveats are in [`docs/DATA_CARD.md`](../../docs/DATA_CARD.md).

The check is reading comprehension, not trade knowledge: does the note say exactly what its answer key says, under [`../LABELING.md`](../LABELING.md)?

## Step 1: Claude panel and the owner's queue (2026-09-30)

1. **Panel.** Sonnet 5.5, Opus 5.5 and Fable 5.1 each checked every draft blind. Each saw only `LABELING.md` and the drafts' `id`, `note` and `gold`. Their verdicts are in `panel/{split}-{model}.jsonl`.
2. **Queue.** `queue.jsonl` (built by `ml/scripts/review_queue.py`) collects 100 drafts for the owner:
   - every draft with a fidelity flag (66);
   - every draft a panelist questioned (17);
   - a seeded random audit of 30 clean drafts.

   The owner was to review them in [`/label/`](https://jobtrail-drab.vercel.app/label/).

**The owner declined manual review (2026-10-02).** They aren't a domain expert and asked for a model review instead. The queue and `/label/` are kept but weren't used for the freeze.

## Step 2: cross-family adjudication (2026-10-02)

Code: `ml/jobtrail_ml/adjudicate.py`, `ml/scripts/adjudicate.py`. The decision rule was committed before any vote.

- **Who reviewed:**
  - **Gemini 3.8 Flash (High)**, via the Antigravity CLI, reviewed all 275.
  - **Claude Opus 5.5**, via subagents, reviewed all 275.
  - **GPT-OSS 120B**, via Antigravity, reviewed only the drafts those two left unsettled (5).
- **What each saw:** the note, the draft key, the tags, and the earlier flags and panel notes as concerns that might be wrong. Each answered accept, edit (full corrected key) or reject (ambiguous note).
- **How it was decided:** a key is final when two reviewers agree on it, using the scorer's zero-edit test both ways. Two rejects, or no agreement, reject the note.

| File (in `adjudication/`)             | What                                                                                                                     |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `batches.json`                        | The 23 batches (b01–b23) every-draft reviewers saw, with each prompt's SHA-256 and the rules' SHA-256                    |
| `vote.schema.json`                    | The response schema every reviewer answered with                                                                         |
| `votes/{gemini,claude}/bNN.json`      | One vote per draft: `{id, action, gold, comment}`                                                                        |
| `tiebreak.json`, `votes/gpt/t01.json` | The 5 unsettled drafts and the tie-breaker's votes                                                                       |
| `decisions.jsonl`                     | One decision per draft, with every vote; the input to `ml/scripts/freeze_eval.py`                                        |
| `stats.json`                          | Votes per reviewer, agreement with the final key, tie-breaks                                                             |
| `pilot/`                              | A one-batch pilot under the earlier `LABELING.md`. It exposed three ambiguous rules, which were clarified before the run |
| `superseded/`                         | Partial runs by models the owner later swapped out (`gemini-3.1-pro-high`, `gpt-6-astra`); not used                      |

`stats.json` in this folder (written by the freeze step) has the outcomes by reason, the fields corrected and the change rate of clean drafts.

Reproduce (from `ml/`): `uv run python scripts/adjudicate.py decide`, then `uv run python scripts/freeze_eval.py`.
