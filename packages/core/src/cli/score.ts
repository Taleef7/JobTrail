// pnpm score --gold <gold.jsonl> --pred <pred.jsonl> --out <report.json> [--run name] [--threshold 0.5]
// Runs on Node 24's built-in TypeScript support (no build step, no tsx).
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { parseArgs } from "node:util";
import type { z } from "zod";
import { ScoreReportSchema, type Metrics } from "../report.ts";
import { GoldRecordSchema, PredictionRecordSchema, scoreRun } from "../score.ts";

/** Parse and validate every line; errors name the file and the real line number. */
function readJsonl<S extends z.ZodType>(path: string, schema: S): z.infer<S>[] {
  const out: z.infer<S>[] = [];
  readFileSync(path, "utf8")
    .split(/\r?\n/)
    .forEach((line, i) => {
      if (line.trim() === "") return;
      const where = `${path}:${i + 1}`;
      let json: unknown;
      try {
        json = JSON.parse(line);
      } catch {
        throw new Error(`${where}: invalid JSON`);
      }
      const result = schema.safeParse(json);
      if (!result.success) {
        const issues = result.error.issues.map(
          (e) => `${e.path.join(".") || "(root)"}: ${e.message}`,
        );
        throw new Error(`${where}: ${issues.join("; ")}`);
      }
      out.push(result.data);
    });
  return out;
}

const pct = (v: number | null) => (v === null ? "  n/a" : `${(v * 100).toFixed(1).padStart(5)}%`);

export function summarize(m: Metrics): string {
  return [
    `n=${m.n}`,
    `zero-edit ${pct(m.zeroEditRate)}   parse ${pct(m.parseRate)}   schema-valid ${pct(m.schemaValidRate)}`,
    `jobType ${pct(m.jobTypeAccuracy)}   laborMinutes ${pct(m.laborMinutesAccuracy)}   approved ${pct(m.customerApprovedAccuracy)}`,
    `materials F1 ${pct(m.materials.f1)} (qty ${pct(m.materials.quantityAccuracy)})   work F1 ${pct(m.workPerformed.f1)}   issues F1 ${pct(m.issuesFound.f1)}   follow-ups F1 ${pct(m.followUps.f1)}`,
    `hallucination ${pct(m.hallucinationRate)}   latency ${m.latency ? `p50 ${m.latency.p50WallMs} ms / p90 ${m.latency.p90WallMs} ms` : "n/a"}`,
  ].join("\n");
}

export function main(argv: string[]): number {
  const { values } = parseArgs({
    args: argv,
    options: {
      gold: { type: "string" },
      pred: { type: "string" },
      out: { type: "string" },
      run: { type: "string" },
      threshold: { type: "string" },
    },
  });
  if (!values.gold || !values.pred) {
    console.error(
      "usage: pnpm score --gold <gold.jsonl> --pred <pred.jsonl> [--out report.json] [--run name]",
    );
    return 2;
  }
  const report = scoreRun(
    readJsonl(values.gold, GoldRecordSchema),
    readJsonl(values.pred, PredictionRecordSchema),
    {
      run: values.run ?? basename(values.pred, ".jsonl"),
      ...(values.threshold ? { threshold: Number(values.threshold) } : {}),
    },
  );
  ScoreReportSchema.parse(report); // never write a report that breaks the contract
  if (values.out) writeFileSync(values.out, `${JSON.stringify(report, null, 2)}\n`);
  console.log(summarize(report.overall));
  if (report.unmatchedPredictionIds.length > 0) {
    console.warn(`warning: ${report.unmatchedPredictionIds.length} predictions had no gold record`);
  }
  if (report.matcher.provisional)
    console.warn("note: matcher threshold is provisional (see SCORING.md)");
  return 0;
}

if (import.meta.main) process.exitCode = main(process.argv.slice(2));
