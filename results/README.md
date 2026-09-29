# Results

Score reports produced by `pnpm score`; every number is defined in [`packages/core/SCORING.md`](../packages/core/SCORING.md).

| File               | What it is                                                                                                                    |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `rules.demo.jsonl` | Rule-based baseline (`rules-legacy-v0`) predictions on the 3 **demo fixtures** (`packages/core/fixtures/scoring/gold.jsonl`). |
| `rules.json`       | Its score report.                                                                                                             |

**These are not the baseline's real numbers.** n = 3 hand-written demo notes shows the pipeline works end to end; it measures nothing. The real floor is produced by the same two commands on the frozen test set (#71) in the baseline ladder (#73), which replaces these files. The matcher threshold is still provisional (`matcher.provisional: true`).

Reproduce:

```bash
pnpm baseline --gold packages/core/fixtures/scoring/gold.jsonl --out results/rules.demo.jsonl
pnpm score --gold packages/core/fixtures/scoring/gold.jsonl --pred results/rules.demo.jsonl --out results/rules.json --run rules-demo
```

Latency (`timings.wallMs`) is measured per run on the machine that ran it, so it differs between runs; everything else is deterministic.
