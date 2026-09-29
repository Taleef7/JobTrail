# How JobTrail scores extraction

Every number in the README, on the web results page and in the phone benchmark comes from `scoreRun()` in `src/score.ts`. This page defines them.

```bash
pnpm score --gold <gold.jsonl> --pred <pred.jsonl> --out results/<run>.json
```

## Inputs

- **Gold** (one JSON object per line): `{ id, note, gold: <schema v2 record>, source, tags[] }` — see `data/README.md`.
- **Predictions**: `{ id, raw, format?: "full" | "compact", model?, timings?: { wallMs, ... } }`. `raw` is the model's text exactly as generated.

## Parsing — failures always count

Each `raw` goes through `parseModelOutput` (the same parser the apps use). A record is:

| `parse`   | Meaning                             | Scored as             |
| --------- | ----------------------------------- | --------------------- |
| `ok`      | valid JSON that satisfies schema v2 | field by field, below |
| `schema`  | valid JSON that violates schema v2  | **fully wrong**       |
| `json`    | no parseable JSON object            | **fully wrong**       |
| `missing` | no prediction with this id          | **fully wrong**       |

"Fully wrong" = every scalar incorrect, every gold list item and material a false negative, not zero-edit. Failures are never dropped — otherwise a model that often fails would look accurate.

## Per-field metrics

| Metric                                                                | Definition                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `jobTypeAccuracy`, `laborMinutesAccuracy`, `customerApprovedAccuracy` | Share of records where the value equals gold exactly (`null` is a value: predicting `null` when gold is `null` is correct).                                                                                                                                                                                                                                                    |
| `workPerformed`, `issuesFound`, `followUps` — precision/recall/F1     | Items matched one-to-one with the fuzzy matcher (below); micro-averaged over all records. Nothing predicted → precision 1; nothing to find → recall 1.                                                                                                                                                                                                                         |
| `materials` — precision/recall/F1                                     | Same, matching on material **name**.                                                                                                                                                                                                                                                                                                                                           |
| `materials.quantityAccuracy`                                          | Of the matched materials, the share whose quantity is exactly right (`null` = `null`). `null` when nothing matched.                                                                                                                                                                                                                                                            |
| `zeroEditRate`                                                        | Share of records a user could accept **without any edit**: all scalars right, every list and material matched both ways (no extras, none missing), matched quantities and units right. The headline product metric.                                                                                                                                                            |
| `parseRate` / `schemaValidRate`                                       | Share with parseable JSON (`ok` or `schema`) / share that also satisfies the schema (`ok`).                                                                                                                                                                                                                                                                                    |
| `hallucinationRate`                                                   | Share of predicted material names and quantities **not supported by the note**: a name is supported if at least half its normalized tokens appear in the note; a quantity if the note contains it as digits or a number word (one–twelve, dozen, half, couple, pair). `laborMinutes` is excluded — it's derived ("an hour and a half" → 90), so it can't be checked by lookup. |
| `latency`                                                             | Nearest-rank p50/p90 of `timings.wallMs`; `null` when no prediction has timings.                                                                                                                                                                                                                                                                                               |

Every metric is also reported **by source** (synthetic / role-played / …) and **by hard-case tag**, each with its own `n`. Small slices are noisy; read them with their `n`.

## The fuzzy matcher

Text is lowercased, split on non-alphanumerics, stripped of a few stopwords (a, an, and, at, for, in, of, on, some, the, to, with) and naively singularized. Two strings match when the **Dice coefficient** of their token sets, 2|A∩B| / (|A|+|B|), is ≥ **0.5**. Matching is one-to-one and greedy by score.

The threshold is **provisional** until it's validated against human judgments: the owner labels the 50 pairs in `data/matcher-validation.csv` as same/different, and `src/matcher-validation.test.ts` requires ≥ 90 % agreement. Every report records the threshold and whether it was provisional (`matcher.provisional`).

**Known weakness, measured:** on short phrases a single shared word reaches 0.5, so at this threshold "copper pipe" matches "PVC pipe" (0.50), "Replaced breaker" matches "Reset breaker" (0.50) and "Painted bedroom walls" matches "Painted bedroom ceiling" (0.67) — all false matches — while "teflon tape" matches "plumber's tape" (0.50) correctly by luck. The matcher has no synonyms, word order or negation. The owner's labels decide whether the threshold moves, or whether the matcher needs more than token overlap.

## Report contract

`ScoreReportSchema` (`src/report.ts`), generated as `schema/score-report.v1.json`. The CLI refuses to write a report that doesn't satisfy it.
