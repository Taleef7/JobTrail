# Evidence — #68 scorer

`demo-report.json` was produced by:

```bash
pnpm score --gold packages/core/fixtures/scoring/gold.jsonl --pred packages/core/fixtures/scoring/pred.jsonl --out evidence/68/demo-report.json --run demo
```

Three hand-made records: one perfect prediction, one with a wrong material quantity and a wrong approval value, one unparseable ("Okay, I understand."). Every number was checked by hand:

| Metric               | Value                    | Why                                                                     |
| -------------------- | ------------------------ | ----------------------------------------------------------------------- |
| zero-edit            | 1/3                      | only the perfect record needs no edits                                  |
| parse / schema-valid | 2/3                      | the unparseable record counts as fully wrong, not dropped               |
| materials F1         | 0.857                    | tp 3, fp 0, fn 1 (unparseable record's gold material) → P 1, R 0.75     |
| quantity accuracy    | 2/3                      | "wire nuts: 2" vs gold 3                                                |
| hallucination        | 1/6                      | the model's "thermostat: 1" — neither "1" nor "one" appears in the note |
| latency              | p50 1400 ms, p90 2100 ms | nearest rank over 350 / 1400 / 2100 ms                                  |

The matcher threshold is **provisional** (`matcher.provisional: true`) until the owner labels `data/matcher-validation.csv`.
