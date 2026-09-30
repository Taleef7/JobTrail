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

| Metric                                                                | Definition                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `jobTypeAccuracy`, `laborMinutesAccuracy`, `customerApprovedAccuracy` | Share of records where the value equals gold exactly (`null` is a value: predicting `null` when gold is `null` is correct).                                                                                                                                                                                                                                                                                                                                                         |
| `workPerformed`, `issuesFound`, `followUps` — precision/recall/F1     | Items matched one-to-one with the fuzzy matcher (below); micro-averaged over all records. Nothing predicted → precision 1; nothing to find → recall 1.                                                                                                                                                                                                                                                                                                                              |
| `materials` — precision/recall/F1                                     | Same, matching on material **name**.                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `materials.quantityAccuracy`                                          | Of the matched materials, the share whose quantity is exactly right (`null` = `null`). `null` when nothing matched.                                                                                                                                                                                                                                                                                                                                                                 |
| `zeroEditRate`                                                        | Share of records a user could accept **without any edit**: all scalars right, every list and material matched both ways (no extras, none missing), matched quantities and units right. The headline product metric.                                                                                                                                                                                                                                                                 |
| `parseRate` / `schemaValidRate`                                       | Share with parseable JSON (`ok` or `schema`) / share that also satisfies the schema (`ok`).                                                                                                                                                                                                                                                                                                                                                                                         |
| `hallucinationRate`                                                   | Share of predicted material names and quantities **not supported by the note**: a name is supported if at least half its normalized tokens appear in the note; a quantity if the note contains it as digits or a number word (one–twelve, dozen, half, couple, pair), or — for 1 only — says "a"/"an" in front of that material ([below](#quantity-1-said-as-an-article)). `laborMinutes` is excluded — it's derived ("an hour and a half" → 90), so it can't be checked by lookup. |
| `latency`                                                             | Nearest-rank p50/p90 of `timings.wallMs`; `null` when no prediction has timings.                                                                                                                                                                                                                                                                                                                                                                                                    |

Every metric is also reported **by source** (synthetic / role-played / …) and **by hard-case tag**, each with its own `n`. Small slices are noisy; read them with their `n`.

### Quantity 1 said as an article

People say "used a wax ring", not "used one wax ring". If "a"/"an" were never a number, a model that correctly extracts quantity 1 would be scored as hallucinating. But digits and number words are looked up **anywhere in the note**, and almost every note contains "a", so counting it the same way would ground **every** predicted quantity 1, including invented ones. The article rule trades those two errors off:

- "a"/"an" counts as 1 **only for the material it introduces**: within the next **3 words** of the same clause, one of the material's name tokens or its unit must appear. Words are split on spaces, so "40-gallon" and "1.5-inch" are one word each; stopword-only words ("of", "the") don't count toward the 3. `; : ! ?` end a clause, and so do a comma (except inside "1,000") and a period (only before a space or the end, and not after a single-letter initial, so "1.5" and "A.O. Smith" don't). "set it on a new wax ring" grounds _wax ring: 1_; "a box of deck screws" grounds _deck screws: 1 box_; "a new 40-gallon water heater" grounds _water heater: 1_; "a 50 foot roll of Romex" grounds _Romex: 1 roll_ through the unit.
- Not when the next word is a vague amount: "a few", "a bunch of", "a handful of", "a lot of", "a little", "a bit of". ("a couple", "a dozen" and "a half" are already 2, 12 and 0.5.)
- Other quantities, and a 1 said as "1"/"one", keep the note-wide lookup.

Measured on the #70 drafts (`data/drafts/pilot-4`, rules baseline and gold-as-prediction), the note-wide alternative marked **2 invented quantity-1 materials** as grounded ("And the whole job took 40 minutes: 1", …) while fixing the one correct answer this rule also fixes ("a box of deck screws"). The article rule grounds neither invented one. Those drafts rarely lean on articles: their writer is given "1 wax ring", so it usually says the digit. Role-played and spoken notes will lean on articles far more.

**Known misses, erring toward "ungrounded":** "the" is not a count ("replaced the thermostat" leaves _thermostat: 1_ ungrounded; the demo report's one ungrounded check is this case), and long modifier runs exceed the reach ("a brand new 40-gallon water heater"). **Known false grounding:** any shared name token counts, so "a hole in the drywall" grounds _drywall patch kit: 1_. Grounding is a lookup, not proof.

`ml/jobtrail_ml/fidelity.py` (#70) deliberately differs. Its fidelity flags check the _plan_ against the note written from it, as pointers for a human reviewer who reads every note anyway (#71). There, "a"/"an" counts as 1 note-wide: a missed flag costs little, and a false one costs review time. Here, a false "grounded" hides a real hallucination inside a headline number, so the scorer takes the stricter rule.

## The fuzzy matcher

Text is lowercased, split on non-alphanumerics, stripped of a few stopwords (a, an, and, at, for, in, of, on, some, the, to, with) and naively singularized. Two strings match when the **Dice coefficient** of their token sets, 2|A∩B| / (|A|+|B|), is ≥ **0.5**. Matching is one-to-one and greedy by score. Reports record this as `matcher.method: "token-dice-v2"` (#114); plain `"token-dice"` marks reports made before it.

Three additions (#114), each in `src/match.ts` and small enough to read in one sitting:

- **Synonyms.** A short table of wordings tradespeople use for the same thing: plumber's / teflon / thread seal tape; receptacle → outlet; replaced / swapped out / installed new; patched / repaired / fixed; sealed / caulked; recharged / topped off. Matching only: grounding still uses the words as said.
- **Conflict rule.** If both sides name a room (kitchen, bathroom, …), a surface (wall, ceiling, door, …) or a pipe material (copper, PVC, PEX, …) and the names don't overlap, it's not a match: "outlet in bathroom" ≠ "outlet in kitchen", "copper pipe" ≠ "PVC pipe". Naming a room on one side only doesn't count against a match.
- **Head nouns (materials only).** A material name ends in the item, so the last word must agree ("roofing cement" ≠ "roofing nail", "furnace filter" = "air filter"), unless one name is contained in the other ("breaker" = "20 amp breaker"). Statements often end on a place, not the item, so they don't get this rule.

**Validation.** `src/matcher-validation.test.ts` requires ≥ 90 % agreement on each of three labeled sets, so the default threshold is no longer provisional (`matcher.provisional: false`). A report made with any other `--threshold` is marked provisional:

| Set                                   | Pairs | Source                                       | Before #114 |        Now |
| ------------------------------------- | ----: | -------------------------------------------- | ----------: | ---------: |
| `data/matcher-validation.csv`         |    50 | hand-written (#68)                           |      80.0 % |      100 % |
| `data/matcher-validation-heldout.csv` |    60 | dev drafts: blind checker extraction vs gold |      86.7 % |      100 % |
| `data/matcher-validation-blind.csv`   |    58 | test drafts, same way                        |      87.9 % | **93.1 %** |

The first two sets were used to design the additions, so their 100 % is expected. The third was labeled and frozen before the matcher was run on it, which happened once. Labels come from a model panel (Sonnet 5.5, Opus 5.5, Fable 5.1, each labeling blind; plus the #68 reference labels on the first two sets), which agreed on every pair of all three sets. It's one model family standing in for a trade expert, and the data README says so. `pnpm matcher-pairs` regenerates the sampled sets.

**Known weakness, measured:** the same item with a different action still matches, since the item words dominate. All 4 misses on the blind set are this kind, plus a synonym the table lacks: "Replaced dryer heating element" vs "Picked up dryer heating element at the supply house" (both directions), "Secured gutters" vs "Cleaned gutters", and "Installed single pole switch" vs "Added a new wall switch" (a real match that's missed). The matcher still has no word order or negation. On the 110 dev drafts, the rules baseline and the checker's extractions score identically under the old and new matcher; the difference shows up on messier model output.

## Report contract

`ScoreReportSchema` (`src/report.ts`), generated as `schema/score-report.v1.json`. The CLI refuses to write a report that doesn't satisfy it.
