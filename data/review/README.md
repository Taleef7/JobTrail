# data/review/ (#71)

The inputs to the owner's review of the 275 eval drafts before the test set is frozen.

## How the review works (hybrid; owner decision, 2026-09-30)

The check is reading comprehension, not trade knowledge: does the note say exactly what its answer key says, under [`../LABELING.md`](../LABELING.md)?

1. **Model panel.** Sonnet 5.5, Opus 5.5 and Fable 5.1 each checked every draft alone. Each saw only `LABELING.md` and the drafts' `id`, `note` and `gold`, not the flags, the plan or each other's verdicts. Each lists concrete discrepancies per field. Their verdicts are in `panel/{split}-{model}.jsonl`.
2. **Review queue.** `queue.jsonl` is built by `ml/scripts/review_queue.py`. It holds every draft with a fidelity flag from #70 or a problem reported by any panelist, plus a seeded random **audit** of 30 drafts that nothing flagged (seed 71).
3. **Owner review.** The owner reviews the queue at [`/label/`](https://jobtrail-drab.vercel.app/label/), accepting, editing or rejecting each note, and downloads the decisions as JSONL. The audit estimates how often a "clean" draft is still wrong.

## Numbers

|                                           |            Test |             Dev |   Total |
| ----------------------------------------- | --------------: | --------------: | ------: |
| Drafts                                    |             165 |             110 |     275 |
| Panel verdicts OK (Sonnet / Opus / Fable) | 154 / 152 / 155 | 108 / 108 / 108 |         |
| Queued for the owner                      |              61 |              39 | **100** |

The 100 queued drafts break down as:

- **66** with fidelity flags;
- **17** questioned by the panel (13 of these are also flagged; 11 were questioned by all three panelists);
- **30** audited.

**Pattern the panel found:** a problem found and fixed in the note ("put down roofing cement to fix the lifted shingles") often has its fix missing from `workPerformed`. `LABELING.md` requires both the issue and the fix. The drafts were planned record-first, and the writer sometimes narrated a fix the plan didn't list. The owner's review corrects these one by one; the data card (#71) reports the edit rate.

## Files

| File                                         | What                                                                                                                 |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `panel/{test,dev}-{sonnet,opus,fable}.jsonl` | One verdict per draft: `{id, ok, problems: [{field, issue}]}`                                                        |
| `queue.jsonl`                                | Review items: `{id, split, note, gold, tags, flags, panel, reasons}`, where `reasons` ⊆ `fidelity`, `panel`, `audit` |

Rebuild the queue (from `ml/`): `uv run python scripts/review_queue.py`.

## The owner's decisions (input to the freeze step)

`/label/` exports one JSON line per reviewed item: `{id, split, action, gold, comment, reviewedAt, draftHash, draft}`.

- `action` is `accept` (the draft key is right), `edit` (`gold` is the corrected key) or `reject` (the note is ambiguous; `gold` is null and `comment` says why).
- `draftHash` fingerprints the note plus the draft key the owner saw. The freeze step joins each decision to its draft by `id` and refuses any line whose hash no longer matches.
- The freeze step requires a decision for **all 100** queued items.
- The 175 drafts that were never queued (no flag, all three panelists OK, not audited) are kept on the panel's verdict and marked as panel-verified, not human-verified.
