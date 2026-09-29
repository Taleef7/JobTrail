import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { extractWithRules, RULES_MODEL_ID } from "../baselines/rules.ts";
import { PredictionRecordSchema } from "../score.ts";
import { main as baseline } from "./baseline.ts";
import { main as score } from "./score.ts";

const fixtures = join(import.meta.dirname, "..", "..", "fixtures", "scoring");
const gold = join(fixtures, "gold.jsonl");

describe("pnpm baseline CLI", () => {
  it("writes one valid prediction per gold note, then pnpm score accepts it", () => {
    const dir = mkdtempSync(join(tmpdir(), "jobtrail-baseline-"));
    const pred = join(dir, "rules.jsonl");
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    expect(baseline(["--gold", gold, "--out", pred])).toBe(0);
    const golds = readFileSync(gold, "utf8")
      .split(/\r?\n/)
      .filter((l) => l.trim() !== "")
      .map((l) => JSON.parse(l) as { id: string; note: string });
    const preds = readFileSync(pred, "utf8")
      .split(/\r?\n/)
      .filter((l) => l.trim() !== "")
      .map((l) => PredictionRecordSchema.parse(JSON.parse(l)));

    expect(preds.map((p) => p.id)).toEqual(golds.map((g) => g.id));
    preds.forEach((p, i) => {
      expect(p.model).toBe(RULES_MODEL_ID);
      expect(p.format).toBe("full");
      expect(p.timings?.wallMs).toBeGreaterThanOrEqual(0);
      expect(JSON.parse(p.raw)).toEqual(extractWithRules(golds[i]?.note ?? ""));
    });

    const report = join(dir, "rules.json");
    expect(score(["--gold", gold, "--pred", pred, "--out", report, "--run", "rules"])).toBe(0);
    const r = JSON.parse(readFileSync(report, "utf8")) as { model: string; overall: { n: number } };
    expect(r.model).toBe(RULES_MODEL_ID);
    expect(r.overall.n).toBe(golds.length);
    vi.restoreAllMocks();
  });

  it("accepts a notes-only file and rejects a line without a note (file:line)", () => {
    const dir = mkdtempSync(join(tmpdir(), "jobtrail-baseline-"));
    const notes = join(dir, "notes.jsonl");
    writeFileSync(
      notes,
      `${JSON.stringify({ id: "a", note: "used 2 wire nuts" })}\n\n{"id":"b"}\n`,
    );
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    expect(() => baseline(["--gold", notes, "--out", join(dir, "p.jsonl")])).toThrow(
      /notes\.jsonl:3[\s\S]*note/,
    );
    vi.restoreAllMocks();
  });

  it("exits with usage (code 2) when inputs are missing", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(baseline([])).toBe(2);
    vi.restoreAllMocks();
  });
});
