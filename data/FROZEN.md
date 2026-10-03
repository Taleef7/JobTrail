# Frozen eval data

Frozen on 2026-10-03 by `ml/scripts/freeze_eval.py` (#71).
`ml/tests/test_frozen.py` runs in CI and fails if any file below changes.
These files are **never edited**: additions (e.g. the spoken-note slice, #92)
go into a new versioned file whose hash is appended here.

| File              | Records | SHA-256                                                            |
| ----------------- | ------: | ------------------------------------------------------------------ |
| `data/test.jsonl` |     163 | `e208cfdca9b334fa07f2e612f8c02e8a038990158fedbf1ea48a809fb2627390` |
| `data/dev.jsonl`  |     110 | `393d67aef350bba1be49ea9ee97de608acec3fd969e4db523ca5970d67d3a679` |
