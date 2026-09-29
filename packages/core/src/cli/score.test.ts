import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ScoreReportSchema } from "../report.ts";
import { main } from "./score.ts";

const fixtures = join(import.meta.dirname, "..", "..", "fixtures", "scoring");

describe("pnpm score CLI", () => {
  it("scores the demo set and writes a report that satisfies the contract", () => {
    const out = join(mkdtempSync(join(tmpdir(), "jobtrail-score-")), "report.json");
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const code = main([
      "--gold", join(fixtures, "gold.jsonl"),
      "--pred", join(fixtures, "pred.jsonl"),
      "--out", out,
    ]); // prettier-ignore
    expect(code).toBe(0);
    const report = ScoreReportSchema.parse(JSON.parse(readFileSync(out, "utf8")));
    expect(report.overall.n).toBe(3);
    expect(report.overall.zeroEditRate).toBeCloseTo(1 / 3, 10);
    expect(report.overall.hallucinationRate).toBeCloseTo(1 / 6, 10);
    expect(log.mock.calls[0]?.[0]).toContain("zero-edit");
    vi.restoreAllMocks();
  });

  it("exits with usage (code 2) when inputs are missing", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(main([])).toBe(2);
    vi.restoreAllMocks();
  });

  it("rejects malformed JSONL records with file and line number", () => {
    const dir = mkdtempSync(join(tmpdir(), "jobtrail-score-"));
    const goldPath = join(dir, "gold.jsonl");
    const predPath = join(dir, "pred.jsonl");
    const firstLine = readFileSync(join(fixtures, "gold.jsonl"), "utf8").split(/\r?\n/)[0] ?? "";
    const good = JSON.parse(firstLine) as { gold: Record<string, unknown> };
    // line 2: the nested gold record violates schema v2 (fractional laborMinutes)
    const bad = { ...good, id: "x", gold: { ...good.gold, laborMinutes: 1.5 } };
    writeFileSync(goldPath, `${firstLine}\n${JSON.stringify(bad)}\n`);
    writeFileSync(predPath, `${JSON.stringify({ id: "demo-1" })}\n`); // missing raw
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    expect(() => main(["--gold", goldPath, "--pred", predPath])).toThrow(
      /gold\.jsonl:2[\s\S]*laborMinutes/,
    );
    writeFileSync(goldPath, `${firstLine}\n`);
    expect(() => main(["--gold", goldPath, "--pred", predPath])).toThrow(/pred\.jsonl:1[\s\S]*raw/);
    vi.restoreAllMocks();
  });
});
