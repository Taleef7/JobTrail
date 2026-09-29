// pnpm baseline --gold <gold.jsonl | notes.jsonl> --out <pred.jsonl>
// Runs the legacy rule-based extractor on every note and writes prediction
// lines for `pnpm score`. Only `id` and `note` are read from each input line.
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { extractWithRules, RULES_MODEL_ID } from "../baselines/rules.ts";
import { GoldRecordSchema, type PredictionRecord } from "../score.ts";
import { readJsonl } from "./jsonl.ts";

const NoteSchema = GoldRecordSchema.pick({ id: true, note: true });

export function main(argv: string[]): number {
  const { values } = parseArgs({
    args: argv,
    options: { gold: { type: "string" }, out: { type: "string" } },
  });
  if (!values.gold || !values.out) {
    console.error("usage: pnpm baseline --gold <gold.jsonl> --out <pred.jsonl>");
    return 2;
  }
  const lines = readJsonl(values.gold, NoteSchema).map(({ id, note }): PredictionRecord => {
    const start = performance.now();
    const raw = JSON.stringify(extractWithRules(note));
    const wallMs = Math.round((performance.now() - start) * 1000) / 1000;
    return { id, raw, format: "full", model: RULES_MODEL_ID, timings: { wallMs } };
  });
  writeFileSync(values.out, lines.map((l) => `${JSON.stringify(l)}\n`).join(""));
  console.log(`${RULES_MODEL_ID}: ${lines.length} predictions → ${values.out}`);
  return 0;
}

if (import.meta.main) process.exitCode = main(process.argv.slice(2));
