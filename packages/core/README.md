# @jobtrail/core

The extraction contract shared by the eval harness (`ml/`), the web demo and the phone app. One source of truth: a Zod schema, from which everything else is generated.

```ts
import { JobRecordSchema, parseModelOutput, encodeCompact, decodeCompact } from "@jobtrail/core";
```

## Schema v2

| Field              | Type                                                 | Meaning                                                                                |
| ------------------ | ---------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `jobType`          | one of 9 trades, or `null`                           | plumbing, electrical, hvac, carpentry, appliance, cleaning, painting, roofing, general |
| `workPerformed`    | non-empty strings                                    | completed work, as short action statements                                             |
| `issuesFound`      | non-empty strings                                    | problems found on site                                                                 |
| `materials`        | `{ name, quantity (> 0 or null), unit (or null) }[]` | what was used                                                                          |
| `laborMinutes`     | integer 0–1440, or `null`                            | total labor ("an hour and a half" → 90)                                                |
| `customerApproved` | boolean, or `null`                                   | only when the note says so explicitly                                                  |
| `followUps`        | non-empty strings                                    | future actions only                                                                    |

Objects are strict: extra keys are invalid at every level.

## Generated files

`schema/schema.v2.json` (full keys) and `schema/schema.v2.compact.json` (short keys) are JSON Schema 2020-12, generated from Zod and used to constrain decoding in llama.cpp, wllama and llama.rn. `src/schema-files.test.ts` fails if they drift from the Zod source; regenerate with `pnpm gen:schema`.

Shared fixtures in `fixtures/schema/{valid,invalid}/` are judged by Zod here and by Python `jsonschema` in `ml/tests/test_schema_parity.py` — both must agree.

## Compact codec

Fine-tuned models can emit short keys (`t w i m{n q u} l a f`) that `decodeCompact` expands. Measured with the Gemma 3 tokenizer on the valid fixtures, compact output is **9.7 % fewer tokens** (339 → 306; see `evidence/67/token-counts.json`) — the values dominate, so the saving is modest. Whether fine-tuned models use full or compact keys is decided in M2 on measured quality, not on this.

## Parsing model output

`parseModelOutput(text, { format })` strips `<think>` blocks, code fences and surrounding prose, then validates with the Zod schema. It returns `{ ok: true, value }` or `{ ok: false, stage: "json" | "schema", errors }`.

**Always validate, even after constrained decoding.** llama.cpp's JSON-Schema grammar enforces structure, types, enums, required keys and no extra keys, but not every numeric constraint: a Gemma 3 270M run constrained by `schema.v2.json` produced `"quantity": 0` although the schema requires `> 0` (`evidence/67/llamacpp-constrained.json`). The grammar makes output parseable; Zod makes it correct-by-contract.
